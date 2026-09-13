import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { config } from "../config";
import { db } from "../db/client";
import { decisions, executions, intents, payments, policies, tools } from "../db/schema";
import { emit } from "../events/bus";
import type { ApiErrorCode, DecisionResult, IssuedCapability, NormalizedIntent, Reason, RiskClass, ToolCall } from "../domain";
import { canonicalize, issueCapability } from "../capability/issue";
import { consumeCapability, revokeCapability } from "../capability/verify";
import { getExecutor, type ExecutorResult } from "../executors/registry";
import { fetchScannerChallenge, getPaymentProvider } from "../payments/x402";
import { GatewayError, ingest } from "./ingest";
import { normalizeIntent } from "./normalize";
import { getContextProvider } from "./context/provider";
import { getApprovalProvider } from "./approval/provider";
import { ledgerApprovalProvider } from "../ledger/keyring";
import { evaluate, selectPolicy, RISK_SCORE, type Rule } from "./policy/engine";
import { logger, redactText } from "../logging";

const log = logger("gateway");

// plan-13 EXACT — the closed error_code set for payment/execution failures.
// Unknown throws are mapped HERE, at the emit boundary, BEFORE failPayment /
// event payload / agent response — raw error text never leaves the process.
const PAYMENT_ERROR_CODES = new Set([
  "SETTLEMENT_ERROR", "EXECUTOR_ERROR", "CHALLENGE_UNAVAILABLE", "PRICE_MISMATCH",
  "SERVICE_PAYMENT_REQUIRED",
  // existing codes minted by the flow itself (provider + pre-checks):
  "SIMULATED_SETTLEMENT_FAILURE", "OPERATOR_NOT_CONFIGURED", "OPERATOR_KEY_NOT_PROTECTED",
  "INVALID_CHALLENGE", "VERIFY_REJECTED", "SETTLEMENT_FAILED",
]);

// plan-13 EXACT: anything outside the closed set — including facilitator
// free-text suffixes — becomes SETTLEMENT_ERROR at the emit boundary.
function normalizePaymentErrorCode(raw: string): string {
  if (PAYMENT_ERROR_CODES.has(raw)) return raw;
  return "SETTLEMENT_ERROR";
}

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

// plan-06: the approval→issuance→execution continuation. Both the allow path
// of runToolCall and the approval-resolve route (plan-06) run this same phase,
// so an approved escalation produces exactly the chain a direct allow would.
export interface ExecutionPhaseInput {
  tenantId: string;
  taskId: string;
  agentId: string;
  agentKey: string;
  intentId: string;
  origin: string;
  tool: string;
  toolRow: typeof tools.$inferSelect | null;
  normalized: NormalizedIntent;
  decision: DecisionResult;
  decisionId: string;
  policyDoc: { name: string; version: number; rules: unknown[] };
  args: Record<string, unknown>;
}

export interface ExecutionPhaseResult {
  capability: IssuedCapability | null;
  payment_required: { price_usd_cents: number; challenge: unknown } | null;
  execution: { execution_id: string; status: "succeeded" | "failed"; result_summary: string | null } | null;
}

export async function runExecutionPhase(input: ExecutionPhaseInput): Promise<ExecutionPhaseResult> {
  const { tenantId, taskId, agentId, agentKey, tool, toolRow, normalized } = input;
  const meta = { agent_key: agentKey, risk_class: normalized.risk_class };

  // The executor lookup happens BEFORE capability issuance so an
  // unknown-executor tool row can never strand an issued-but-untracked
  // capability.
  if (!toolRow) {
    throw new GatewayError("TOOL_NOT_FOUND", `no tool row for ${tool}`);
  }
  const lookup = getExecutor(toolRow);
  if (!lookup.ok) {
    throw new GatewayError("TOOL_NOT_FOUND", `no executor registered for tool: ${tool}`);
  }

  const capability = await issueCapability({
    decision: input.decision,
    decisionId: input.decisionId,
    intent: {
      tool: normalized.tool,
      action: normalized.action,
      resource: normalized.resource,
      amount_usd_cents: normalized.amount_usd_cents,
      agent_key: agentKey,
    },
    policy: input.policyDoc,
  });

  if (normalized.action === "purchase_security_scan" && input.origin === "payment_discovery") {
    // Discovery-marked purchases settle through the purchase wiring in
    // runToolCall, not the generic path below: leave the capability
    // issued-but-unconsumed for it.
    return { capability, payment_required: null, execution: null };
  }

  // Consume-after-execute is forced by the plan's two hard constraints: a
  // payment_required outcome must leave the capability issued-but-unconsumed,
  // and the executions row's "(already returned)" note implies the executor
  // ran before the row insert. A fresh capability cannot reject here in
  // practice (issue → consume within one request).
  const capabilityId = capability.capability_id;
  const budget = capability.budget_usd_cents;

  let outcome: ExecutorResult | { threw: string };
  try {
    outcome = await lookup.executor.execute({
      capability: {
        id: capabilityId,
        action: normalized.action,
        resource: normalized.resource,
        budgetUsdCents: budget,
      },
      args: input.args,
    });
  } catch (err) {
    outcome = { threw: err instanceof Error ? err.message : String(err) };
  }

  if (!("threw" in outcome) && "status" in outcome) {
    // payment_required — the ONLY non-executing path: no executions row, no
    // consume; the capability stays issued-but-unconsumed and expires.
    return {
      capability,
      payment_required: { price_usd_cents: outcome.price_usd_cents, challenge: outcome.challenge },
      execution: null,
    };
  }

  const consumed = await consumeCapability(capabilityId, {
    action: normalized.action,
    resource: normalized.resource,
    amount: budget ?? undefined,
  });
  if (consumed.status === "rejected") {
    throw new GatewayError("CAPABILITY_REJECTED", `capability rejected: ${consumed.reason}`);
  }

  const [executionRow] = await db()
    .insert(executions)
    .values({
      capabilityId,
      tool,
      status: "running",
      executor: toolRow.executor,
    })
    .returning();
  await emit(
    {
      event_type: "tool.execution.started",
      tenant_id: tenantId,
      task_id: taskId,
      agent_id: agentId,
      payload: {
        execution_id: executionRow.id,
        capability_id: capabilityId,
        tool,
        resource: normalized.resource,
      },
    },
    meta,
  );

  if ("threw" in outcome) {
    // plan-13: the raw executor error goes ONLY through the redacting logger;
    // the executions row, event payload, and agent response carry the fixed
    // enum — never the possibly key-bearing message.
    await db()
      .update(executions)
      .set({ status: "failed", error: "EXECUTOR_ERROR", completedAt: new Date().toISOString() })
      .where(eq(executions.id, executionRow.id));
    // Server-log the failure too: the DB row + audit event exist, but without
    // this line a broken executor (e.g. an unhandled action) is invisible
    // unless someone queries the trace.
    log.error("executor threw", { tool, action: normalized.action, resource: normalized.resource, error: outcome.threw });
    await emit(
      {
        event_type: "tool.execution.failed",
        tenant_id: tenantId,
        task_id: taskId,
        agent_id: agentId,
        payload: { execution_id: executionRow.id, capability_id: capabilityId, error_code: "EXECUTOR_ERROR" },
      },
      meta,
    );
    return { capability, payment_required: null, execution: { execution_id: executionRow.id, status: "failed", result_summary: null } };
  }

  await db()
    .update(executions)
    .set({ status: "succeeded", resultSummary: outcome.summary, completedAt: new Date().toISOString() })
    .where(eq(executions.id, executionRow.id));
  await emit(
    {
      event_type: "tool.execution.completed",
      tenant_id: tenantId,
      task_id: taskId,
      agent_id: agentId,
      payload: {
        execution_id: executionRow.id,
        capability_id: capabilityId,
        result_summary: outcome.summary,
      },
    },
    meta,
  );

  // task.complete: the plan's execution-phase bullet — mark the task
  // completed, emit task.completed, return summary "Task completed".
  if (normalized.action === "task_complete") {
    await emit(
      {
        event_type: "task.completed",
        tenant_id: tenantId,
        task_id: taskId,
        agent_id: agentId,
        payload: { task_id: taskId, status: "completed", summary: "Task completed" },
      },
      meta,
    );
  }
  return {
    capability,
    payment_required: null,
    execution: { execution_id: executionRow.id, status: "succeeded", result_summary: outcome.summary },
  };
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
    // Per-agent grant narrowing: tenant policy is the ceiling, each agent's
    // declaredCapabilities narrows it. A tool the policy allows but the agent
    // was never granted → deny with the existing tool_not_allowed code under
    // the distinct agent-grant rule id. Unknown tools are NOT caught here —
    // they fall through to the policy's own tool-allowlist deny unchanged.
    const grants = ingested.agent.declaredCapabilities ?? [];
    const policyAllows = policyDoc.rules.some(
      (rule) => rule.type === "tool_allowlist" && (rule.tools ?? []).includes(ingested.intent.tool),
    );
    const result =
      policyAllows && !grants.includes(ingested.intent.tool)
        ? {
            decision: "deny" as const,
            matched_policy: policyName,
            matched_rule_id: "agent-grant",
            reasons: [
              {
                code: "tool_not_allowed" as const,
                detail: `${ingested.agent.agentKey} is not granted ${ingested.intent.tool}`,
              },
            ],
            risk_score: RISK_SCORE[normalized.risk_class],
          }
        : evaluate(normalized, facts, policyDoc.rules, policyName);

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
      // plan-06 provider selection: LEDGER_PROVIDER=ledger routes high-risk
      // approvals through the wallet-cli Key Ring; dev stays the default and
      // is never described as hardware security.
      const approvalProvider =
        config().LEDGER_PROVIDER === "ledger" ? ledgerApprovalProvider() : getApprovalProvider();
      const { approval_id } = await approvalProvider.request({
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

    // allow — the plan-04 execution phase, shared with plan-06's approval
    // resolution (runExecutionPhase).
    const phase = await runExecutionPhase({
      tenantId: ingested.tenantId,
      taskId: ingested.task.id,
      agentId: ingested.agent.id,
      agentKey: ingested.agent.agentKey,
      intentId: ingested.intent.id,
      origin: ingested.intent.origin,
      tool: ingested.intent.tool,
      toolRow: ingested.toolRow,
      normalized,
      decision: result,
      decisionId: decisionRow.id,
      policyDoc,
      args: input.arguments ?? {},
    });
    data.capability = phase.capability;
    data.payment_required = phase.payment_required;
    data.execution = phase.execution;

    // plan-05 discovery signal: the executor hit a 402 (payment_required, no
    // execution). Only the scanner executor produces this arm today.
    if (data.payment_required && !data.execution) {
      await emit(
        {
          event_type: "service.discovered",
          tenant_id: ingested.tenantId,
          task_id: ingested.task.id,
          agent_id: ingested.agent.id,
          payload: {
            intent_id: ingested.intent.id,
            service: "scanner",
            price_usd_cents: data.payment_required.price_usd_cents,
            challenge_ref: createHash("sha256").update(JSON.stringify(data.payment_required.challenge)).digest("hex"),
          },
        },
        meta,
      );
    }

    // plan-05 purchase wiring (purchase intents only). The generic path already
    // ran inside runExecutionPhase above; this branch handles ONLY the
    // discovery-marked purchase: pay, consume, execute. data.execution === null
    // guards direct-execution replays from double-consuming.
    if (normalized.action === "purchase_security_scan" && ingested.intent.origin === "payment_discovery" && data.capability !== null && data.execution === null) {
    const toolRowForLookup = ingested.toolRow;
    if (!toolRowForLookup) {
      throw new GatewayError("TOOL_NOT_FOUND", `no tool row for ${ingested.intent.tool}`);
    }
    const lookup = getExecutor(toolRowForLookup);
    if (!lookup.ok) {
      throw new GatewayError("TOOL_NOT_FOUND", `no executor registered for tool: ${ingested.intent.tool}`);
    }
    const cap = data.capability;
    if (!cap) {
      throw new GatewayError("INTERNAL", "purchase branch without capability");
    }
    const capabilityId = cap.capability_id;
    const budget = cap.budget_usd_cents;
    data.payment_required = null;
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

      // Exception-safety: a throw after a successful on-chain settle must not
      // strand money silently — best-effort reconcile (row failed, event,
      // revoke) before surfacing the error.
      const failPayment = async (errorCode: string, settledRef: string | null): Promise<void> => {
        try {
          await db()
            .update(payments)
            .set(settledRef ? { status: "failed", x402Ref: settledRef, settledAt: new Date().toISOString() } : { status: "failed" })
            .where(eq(payments.id, paymentRow.id));
        } catch { /* best-effort */ }
        try {
          await emit(
            {
              event_type: "payment.failed",
              tenant_id: ingested.tenantId,
              task_id: ingested.task.id,
              agent_id: ingested.agent.id,
              payload: {
                payment_id: paymentRow.id,
                capability_id: capabilityId,
                error_code: errorCode,
              },
            },
            meta,
          );
        } catch { /* best-effort */ }
        try {
          await revokeCapability(capabilityId, "payment_failed");
        } catch { /* best-effort */ }
        data.payment = {
          payment_id: paymentRow.id,
          status: "failed",
          settlement_ref: settledRef,
          error_code: errorCode,
        };
      };
      try {
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
          // plan-13: the code is normalized to the closed set here too — a
          // provider minting an unknown code can never open the set back up.
          await failPayment(normalizePaymentErrorCode(payResult.error_code), null);
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
        // Money settled but the capability could not be consumed — do not
        // leave the authority live; revoke before surfacing the rejection.
        // Best-effort like failPayment's revoke: an emission/DB failure must
        // not mask the settled payment behind a generic INTERNAL error.
        try {
          await revokeCapability(capabilityId, "capability_rejected");
        } catch (err) {
          log.error("post-settle revoke failed", { capability_id: capabilityId, error: err instanceof Error ? err.message : String(err) });
        }
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
        // plan-13: fixed enum into the executions row; raw message stays
        // server-side in the redacting logger.
        await db()
          .update(executions)
          .set({
            status: "failed",
            error: "EXECUTOR_ERROR",
            completedAt: new Date().toISOString(),
          })
          .where(eq(executions.id, purchaseExecRow.id));
        log.error("purchase executor threw", {
          tool: ingested.intent.tool,
          action: normalized.action,
          resource: normalized.resource,
          error: purchaseOutcome.threw,
        });
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
        // service refused the settlement proof → failed execution.
        // plan-13: the executions row carries the fixed enum (the reason text
        // stays server-side in the log), matching the other failed arms.
        await db()
          .update(executions)
          .set({
            status: "failed",
            error: "SERVICE_PAYMENT_REQUIRED",
            completedAt: new Date().toISOString(),
          })
          .where(eq(executions.id, purchaseExecRow.id));
        log.warn("service refused the settlement proof", { tool: ingested.intent.tool, capability_id: capabilityId });
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
      } catch (err) {
        if (data.execution?.status === "succeeded") {
          // The scan already succeeded — the audit chain is complete and
          // honest; surface the error instead of inventing a failure state.
          throw err;
        }
        // Unexpected throw mid-purchase (provider/config/DB) — reconcile
        // best-effort so money and capability are never stranded silently.
        // If settlement already landed on-chain, record the real ref.
        // plan-13 EXACT: the raw error is mapped to the closed enum BEFORE
        // failPayment/event/agent response; the raw text goes only through
        // the redacting logger below.
        const settledRef = data.payment?.status === "completed" ? data.payment.settlement_ref : null;
        const rawMessage = err instanceof Error ? err.message : String(err);
        log.error("purchase threw before completion", {
          tool: ingested.intent.tool,
          action: normalized.action,
          error: rawMessage,
        });
        await failPayment(normalizePaymentErrorCode(rawMessage), settledRef);
        return { ok: true, data };
      }
    }
    return { ok: true, data };
  } catch (err) {
    if (err instanceof GatewayError) {
      return { ok: false, error: { code: err.code, message: err.message } };
    }
    // plan-13: the raw message is scrubbed through the shared redactor before
    // it reaches the agent surface (key=value pairs gone, prose preserved —
    // the wallet-cli/Key Ring failure texts stay actionable).
    const message = redactText(err instanceof Error ? err.message : String(err));
    return { ok: false, error: { code: "INTERNAL", message } };
  }
}
