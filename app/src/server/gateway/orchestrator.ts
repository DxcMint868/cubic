import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { config } from "../config";
import { db } from "../db/client";
import { decisions, executions, intents, payments, policies } from "../db/schema";
import { emit } from "../events/bus";
import type { ApiErrorCode, IssuedCapability, Reason, RiskClass, ToolCall } from "../domain";
import { canonicalize, issueCapability } from "../capability/issue";
import { consumeCapability, revokeCapability } from "../capability/verify";
import { getExecutor, type ExecutorResult } from "../executors/registry";
import { fetchScannerChallenge, getPaymentProvider } from "../payments/x402";
import { GatewayError, ingest } from "./ingest";
import { normalizeIntent } from "./normalize";
import { getContextProvider } from "./context/provider";
import { getApprovalProvider } from "./approval/provider";
import { evaluate, selectPolicy, type Rule } from "./policy/engine";

// plan-00 §G tool-call shape; payment stage fills in as of plan-05 (purchase
// wiring), stays null for non-purchase calls.
export interface ToolCallData {
  intent_id: string;
  decision: "allow" | "deny" | "escalate";
  matched_policy: string;
  matched_rule_id: string;
  reasons: Reason[];
  risk_score: number;
  approval_id: string | null;
  payment_required: { price_usd_cents: number; challenge: unknown } | null;
  capability: IssuedCapability | null;
  payment: {
    payment_id: string;
    status: "completed" | "failed";
    settlement_ref: string | null;
    error_code: string | null;
  } | null;
  execution: { execution_id: string; status: "succeeded" | "failed"; result_summary: string | null } | null;
}

export type ToolCallOutcome =
  | { ok: true; data: ToolCallData }
  | { ok: false; error: { code: ApiErrorCode; message: string } };

// Exported for plan-06's approval-resolve route: reload the exact policy document
// for an escalated decision, re-synthesize the DecisionResult from the persisted
// decision row, and call issueCapability (its escalate gate checks the approval).
export async function loadPolicyDocument(
  tenantId: string,
  policyName: string,
): Promise<{ name: string; version: number; rules: Rule[] }> {
  const [row] = await db()
    .select()
    .from(policies)
    .where(and(eq(policies.tenantId, tenantId), eq(policies.name, policyName)))
    .orderBy(desc(policies.version))
    .limit(1);
  if (!row) return { name: policyName, version: 0, rules: [] };
  return { name: row.name, version: row.version, rules: (row.rules ?? []) as Rule[] };
}

export async function runToolCall(input: ToolCall): Promise<ToolCallOutcome> {
  try {
    const ingested = await ingest(input);

    const normalized = await normalizeIntent({
      tool: ingested.intent.tool,
      args: input.arguments ?? {},
      taskId: ingested.task.id,
    });
    await db()
      .update(intents)
      .set({ normalized, resource: normalized.resource, riskClass: normalized.risk_class })
      .where(eq(intents.id, ingested.intent.id));

    const facts = await getContextProvider().getFacts(
      { taskId: ingested.task.id, tool: ingested.intent.tool },
      {
        agentId: ingested.agent.id,
        toolRow: ingested.toolRow
          ? { defaultRiskClass: ingested.toolRow.defaultRiskClass as RiskClass }
          : null,
      },
    );

    const policyName = selectPolicy(normalized);
    const policyDoc = await loadPolicyDocument(ingested.tenantId, policyName);
    const result = evaluate(normalized, facts, policyDoc.rules, policyName);

    const snapshotHash = createHash("sha256").update(canonicalize(facts)).digest("hex");
    const [decisionRow] = await db()
      .insert(decisions)
      .values({
        intentId: ingested.intent.id,
        decision: result.decision,
        matchedPolicy: result.matched_policy,
        matchedRuleId: result.matched_rule_id,
        reasons: result.reasons,
        contextSnapshotHash: snapshotHash,
        riskScore: result.risk_score,
      })
      .returning();

    const meta = { agent_key: ingested.agent.agentKey, risk_class: normalized.risk_class };
    await emit(
      {
        event_type: "policy.evaluated",
        tenant_id: ingested.tenantId,
        task_id: ingested.task.id,
        agent_id: ingested.agent.id,
        payload: {
          intent_id: ingested.intent.id,
          decision_id: decisionRow.id,
          decision: result.decision,
          matched_policy: result.matched_policy,
          matched_rule_id: result.matched_rule_id,
          reason_codes: result.reasons.map((r) => r.code),
          risk_score: result.risk_score,
        },
      },
      meta,
    );

    const data: ToolCallData = {
      intent_id: ingested.intent.id,
      decision: result.decision,
      matched_policy: result.matched_policy,
      matched_rule_id: result.matched_rule_id,
      reasons: result.reasons,
      risk_score: result.risk_score,
      approval_id: null,
      payment_required: null,
      capability: null,
      payment: null,
      execution: null,
    };

    if (result.decision === "deny") {
      await emit(
        {
          event_type: "capability.denied",
          tenant_id: ingested.tenantId,
          task_id: ingested.task.id,
          agent_id: ingested.agent.id,
          payload: {
            intent_id: ingested.intent.id,
            decision_id: decisionRow.id,
            reason_codes: result.reasons.map((r) => r.code),
          },
        },
        meta,
      );
      return { ok: true, data };
    }

    if (result.decision === "escalate") {
      const { approval_id } = await getApprovalProvider().request({
        decision_id: decisionRow.id,
        action: normalized.action,
        resource: normalized.resource,
        risk_class: normalized.risk_class,
        reason_codes: result.reasons.map((r) => r.code),
      });
      data.approval_id = approval_id;
      await emit(
        {
          event_type: "capability.escalated",
          tenant_id: ingested.tenantId,
          task_id: ingested.task.id,
          agent_id: ingested.agent.id,
          payload: {
            intent_id: ingested.intent.id,
            decision_id: decisionRow.id,
            approval_id,
            reason_codes: result.reasons.map((r) => r.code),
          },
        },
        meta,
      );
      await emit(
        {
          event_type: "ledger.approval.requested",
          tenant_id: ingested.tenantId,
          task_id: ingested.task.id,
          agent_id: ingested.agent.id,
          payload: {
            approval_id,
            decision_id: decisionRow.id,
            provider: config().LEDGER_PROVIDER,
            action: normalized.action,
            resource: normalized.resource,
          },
        },
        meta,
      );
      return { ok: true, data };
    }

    // allow — the plan-04 execution phase. The executor lookup happens BEFORE
    // capability issuance so an unknown-executor tool row can never strand an
    // issued-but-untracked capability.
    if (!ingested.toolRow) {
      return { ok: false, error: { code: "TOOL_NOT_FOUND", message: `no tool row for ${ingested.intent.tool}` } };
    }
    const lookup = getExecutor(ingested.toolRow);
    if (!lookup.ok) {
      return {
        ok: false,
        error: { code: "TOOL_NOT_FOUND", message: `no executor registered for tool: ${ingested.intent.tool}` },
      };
    }

    data.capability = await issueCapability({
      decision: result,
      decisionId: decisionRow.id,
      intent: {
        tool: normalized.tool,
        action: normalized.action,
        resource: normalized.resource,
        amount_usd_cents: normalized.amount_usd_cents,
        agent_key: ingested.agent.agentKey,
      },
      policy: policyDoc,
    });

    // Consume-after-execute is forced by the plan's two hard constraints: a
    // payment_required outcome must leave the capability issued-but-unconsumed,
    // and the executions row's "(already returned)" note implies the executor
    // ran before the row insert. A fresh capability cannot reject here in
    // practice (issue → consume within one request).
    const capabilityId = data.capability.capability_id;
    const budget = data.capability.budget_usd_cents;

    // plan-05 EXACT payment wiring — purchase intents only. The demo agent's
    // follow-up carries origin:"payment_discovery" (plan-05 step 2); agent-origin
    // purchases fall through to the executor's discovery arm below and get
    // payment_required again (no settlement without the discovery marker).
    if (normalized.action === "purchase_security_scan" && ingested.intent.origin === "payment_discovery") {
      const amount = budget ?? normalized.amount_usd_cents ?? 0;
      const [paymentRow] = await db()
        .insert(payments)
        .values({
          capabilityId,
          service: "scanner",
          network: "hedera",
          amountUsdCents: amount,
          status: "requested",
        })
        .returning();
      await emit(
        {
          event_type: "payment.requested",
          tenant_id: ingested.tenantId,
          task_id: ingested.task.id,
          agent_id: ingested.agent.id,
          payload: {
            payment_id: paymentRow.id,
            capability_id: capabilityId,
            service: "scanner",
            network: "hedera",
            amount_usd_cents: amount,
          },
        },
        meta,
      );
      data.payment = {
        payment_id: paymentRow.id,
        status: "failed",
        settlement_ref: null,
        error_code: null,
      };

      // Fresh single-use challenge straight from the live service, then the
      // server-held payment authority settles it through Blocky402 on Hedera.
      let priceUsdCents: number | null = null;
      let challenge: unknown = null;
      try {
        const discovered = await fetchScannerChallenge(
          String(ingested.toolRow?.executorConfig?.endpoint ?? ""),
          normalized.resource,
        );
        priceUsdCents = discovered.price_usd_cents;
        challenge = discovered.challenge;
      } catch {
        priceUsdCents = null;
      }

      let payResult: Awaited<ReturnType<ReturnType<typeof getPaymentProvider>["pay"]>>;
      if (priceUsdCents == null || challenge == null) {
        payResult = { status: "failed", error_code: "CHALLENGE_UNAVAILABLE" };
      } else if (priceUsdCents !== amount) {
        // The agent may not buy at a discount: the service's real price must
        // match the budget-scoped capability it authorized.
        payResult = { status: "failed", error_code: "PRICE_MISMATCH" };
      } else {
        payResult = await getPaymentProvider().pay({
          capability_id: capabilityId,
          service: "scanner",
          amount_usd_cents: priceUsdCents,
          challenge,
        });
      }

      if (payResult.status !== "completed") {
        // EXACT failed branch: row failed + payment.failed + revoke + no execution.
        await db()
          .update(payments)
          .set({ status: "failed" })
          .where(eq(payments.id, paymentRow.id));
        await emit(
          {
            event_type: "payment.failed",
            tenant_id: ingested.tenantId,
            task_id: ingested.task.id,
            agent_id: ingested.agent.id,
            payload: {
              payment_id: paymentRow.id,
              capability_id: capabilityId,
              error_code: payResult.error_code,
            },
          },
          meta,
        );
        await revokeCapability(capabilityId);
        data.payment = {
          payment_id: paymentRow.id,
          status: "failed",
          settlement_ref: null,
          error_code: payResult.error_code,
        };
        return { ok: true, data };
      }

      // Completed: row completed + payment.completed, then consume with the
      // settled numeric amount, then execute the scan.
      await db()
        .update(payments)
        .set({ status: "completed", x402Ref: payResult.settlement_ref, settledAt: new Date().toISOString() })
        .where(eq(payments.id, paymentRow.id));
      await emit(
        {
          event_type: "payment.completed",
          tenant_id: ingested.tenantId,
          task_id: ingested.task.id,
          agent_id: ingested.agent.id,
          payload: {
            payment_id: paymentRow.id,
            capability_id: capabilityId,
            settlement_ref: payResult.settlement_ref,
          },
        },
        meta,
      );
      data.payment = {
        payment_id: paymentRow.id,
        status: "completed",
        settlement_ref: payResult.settlement_ref,
        error_code: null,
      };

      const purchased = await consumeCapability(capabilityId, {
        action: normalized.action,
        resource: normalized.resource,
        amount: priceUsdCents ?? undefined,
      });
      if (purchased.status === "rejected") {
        return {
          ok: false,
          error: { code: "CAPABILITY_REJECTED", message: `capability rejected: ${purchased.reason}` },
        };
      }

      const [purchaseExecRow] = await db()
        .insert(executions)
        .values({
          capabilityId,
          tool: ingested.intent.tool,
          status: "running",
          executor: ingested.toolRow?.executor ?? "scanner",
        })
        .returning();
      await emit(
        {
          event_type: "tool.execution.started",
          tenant_id: ingested.tenantId,
          task_id: ingested.task.id,
          agent_id: ingested.agent.id,
          payload: {
            execution_id: purchaseExecRow.id,
            capability_id: capabilityId,
            tool: ingested.intent.tool,
            resource: normalized.resource,
          },
        },
        meta,
      );
      let purchaseOutcome: ExecutorResult | { threw: string };
      try {
        purchaseOutcome = await lookup.executor.execute({
          capability: {
            id: capabilityId,
            action: normalized.action,
            resource: normalized.resource,
            budgetUsdCents: budget,
          },
          args: input.arguments ?? {},
        });
      } catch (err) {
        purchaseOutcome = { threw: err instanceof Error ? err.message : String(err) };
      }
      // A payment_required arm mid-purchase means the service refused the
      // settlement proof (verifySettlement false / replayed ref) — failed run.
      if ("threw" in purchaseOutcome) {
        await db()
          .update(executions)
          .set({
            status: "failed",
            error: purchaseOutcome.threw,
            completedAt: new Date().toISOString(),
          })
          .where(eq(executions.id, purchaseExecRow.id));
        await emit(
          {
            event_type: "tool.execution.failed",
            tenant_id: ingested.tenantId,
            task_id: ingested.task.id,
            agent_id: ingested.agent.id,
            payload: {
              execution_id: purchaseExecRow.id,
              capability_id: capabilityId,
              error_code: "EXECUTOR_ERROR",
            },
          },
          meta,
        );
        data.execution = { execution_id: purchaseExecRow.id, status: "failed", result_summary: null };
        return { ok: true, data };
      }
      if ("status" in purchaseOutcome) {
        // service refused the settlement proof → failed execution
        await db()
          .update(executions)
          .set({
            status: "failed",
            error: "service returned 402 for the settled purchase",
            completedAt: new Date().toISOString(),
          })
          .where(eq(executions.id, purchaseExecRow.id));
        await emit(
          {
            event_type: "tool.execution.failed",
            tenant_id: ingested.tenantId,
            task_id: ingested.task.id,
            agent_id: ingested.agent.id,
            payload: {
              execution_id: purchaseExecRow.id,
              capability_id: capabilityId,
              error_code: "SERVICE_PAYMENT_REQUIRED",
            },
          },
          meta,
        );
        data.execution = { execution_id: purchaseExecRow.id, status: "failed", result_summary: null };
        return { ok: true, data };
      }
      await db()
        .update(executions)
        .set({ status: "succeeded", resultSummary: purchaseOutcome.summary, completedAt: new Date().toISOString() })
        .where(eq(executions.id, purchaseExecRow.id));
      await emit(
        {
          event_type: "tool.execution.completed",
          tenant_id: ingested.tenantId,
          task_id: ingested.task.id,
          agent_id: ingested.agent.id,
          payload: {
            execution_id: purchaseExecRow.id,
            capability_id: capabilityId,
            result_summary: purchaseOutcome.summary,
          },
        },
        meta,
      );
      data.execution = {
        execution_id: purchaseExecRow.id,
        status: "succeeded",
        result_summary: purchaseOutcome.summary,
      };
      return { ok: true, data };
    }

    let outcome: ExecutorResult | { threw: string };
    try {
      outcome = await lookup.executor.execute({
        capability: {
          id: capabilityId,
          action: normalized.action,
          resource: normalized.resource,
          budgetUsdCents: budget,
        },
        args: input.arguments ?? {},
      });
    } catch (err) {
      outcome = { threw: err instanceof Error ? err.message : String(err) };
    }

    if (!("threw" in outcome) && "status" in outcome) {
      // payment_required — the ONLY non-executing path: no executions row, no
      // consume; the capability stays issued-but-unconsumed and expires.
      // plan-05: the executor↔service 402 is recorded as a service discovery.
      const challengeRef = createHash("sha256").update(JSON.stringify(outcome.challenge)).digest("hex");
      await emit(
        {
          event_type: "service.discovered",
          tenant_id: ingested.tenantId,
          task_id: ingested.task.id,
          agent_id: ingested.agent.id,
          payload: {
            intent_id: ingested.intent.id,
            service: "scanner",
            price_usd_cents: outcome.price_usd_cents,
            challenge_ref: challengeRef,
          },
        },
        meta,
      );
      data.payment_required = { price_usd_cents: outcome.price_usd_cents, challenge: outcome.challenge };
      return { ok: true, data };
    }

    const consumed = await consumeCapability(capabilityId, {
      action: normalized.action,
      resource: normalized.resource,
      amount: budget ?? undefined,
    });
    if (consumed.status === "rejected") {
      return {
        ok: false,
        error: { code: "CAPABILITY_REJECTED", message: `capability rejected: ${consumed.reason}` },
      };
    }

    const [executionRow] = await db()
      .insert(executions)
      .values({
        capabilityId,
        tool: ingested.intent.tool,
        status: "running",
        executor: ingested.toolRow.executor,
      })
      .returning();
    await emit(
      {
        event_type: "tool.execution.started",
        tenant_id: ingested.tenantId,
        task_id: ingested.task.id,
        agent_id: ingested.agent.id,
        payload: {
          execution_id: executionRow.id,
          capability_id: capabilityId,
          tool: ingested.intent.tool,
          resource: normalized.resource,
        },
      },
      meta,
    );

    if ("threw" in outcome) {
      await db()
        .update(executions)
        .set({ status: "failed", error: outcome.threw, completedAt: new Date().toISOString() })
        .where(eq(executions.id, executionRow.id));
      await emit(
        {
          event_type: "tool.execution.failed",
          tenant_id: ingested.tenantId,
          task_id: ingested.task.id,
          agent_id: ingested.agent.id,
          payload: { execution_id: executionRow.id, capability_id: capabilityId, error_code: "EXECUTOR_ERROR" },
        },
        meta,
      );
      data.execution = { execution_id: executionRow.id, status: "failed", result_summary: null };
    } else {
      await db()
        .update(executions)
        .set({ status: "succeeded", resultSummary: outcome.summary, completedAt: new Date().toISOString() })
        .where(eq(executions.id, executionRow.id));
      await emit(
        {
          event_type: "tool.execution.completed",
          tenant_id: ingested.tenantId,
          task_id: ingested.task.id,
          agent_id: ingested.agent.id,
          payload: {
            execution_id: executionRow.id,
            capability_id: capabilityId,
            result_summary: outcome.summary,
          },
        },
        meta,
      );
      data.execution = { execution_id: executionRow.id, status: "succeeded", result_summary: outcome.summary };

      // task.complete: the plan's execution-phase bullet — mark the task
      // completed, emit task.completed, return summary "Task completed".
      if (normalized.action === "task_complete") {
        await emit(
          {
            event_type: "task.completed",
            tenant_id: ingested.tenantId,
            task_id: ingested.task.id,
            agent_id: ingested.agent.id,
            payload: { task_id: ingested.task.id, status: "completed", summary: "Task completed" },
          },
          meta,
        );
      }
    }
    return { ok: true, data };
  } catch (err) {
    if (err instanceof GatewayError) {
      return { ok: false, error: { code: err.code, message: err.message } };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: { code: "INTERNAL", message } };
  }
}
