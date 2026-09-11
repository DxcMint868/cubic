import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { config } from "../config";
import { db } from "../db/client";
import { decisions, intents, policies } from "../db/schema";
import { emit } from "../events/bus";
import type { ApiErrorCode, Reason, RiskClass, ToolCall } from "../domain";
import { GatewayError, ingest } from "./ingest";
import { normalizeIntent } from "./normalize";
import { getContextProvider } from "./context/provider";
import { getApprovalProvider } from "./approval/provider";
import { evaluate, selectPolicy, type Rule } from "./policy/engine";

// plan-03's canonicalize (recursive key sort, no spaces) — reused here for the facts snapshot hash.
function canonicalize(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(canonicalize).join(",") + "]";
  if (v && typeof v === "object") {
    return "{" + Object.keys(v as Record<string, unknown>).sort()
      .map((k) => JSON.stringify(k) + ":" + canonicalize((v as Record<string, unknown>)[k])).join(",") + "}";
  }
  return JSON.stringify(v);
}

// plan-00 §G tool-call shape; stages capability/payment/execution/payment_required stay null until their plans land.
export interface ToolCallData {
  intent_id: string;
  decision: "allow" | "deny" | "escalate";
  matched_policy: string;
  matched_rule_id: string;
  reasons: Reason[];
  risk_score: number;
  approval_id: string | null;
  payment_required: null;
  capability: null;
  payment: null;
  execution: null;
}

export type ToolCallOutcome =
  | { ok: true; data: ToolCallData }
  | { ok: false; error: { code: ApiErrorCode; message: string } };

async function loadPolicyRules(tenantId: string, policyName: string): Promise<Rule[]> {
  const [row] = await db()
    .select()
    .from(policies)
    .where(and(eq(policies.tenantId, tenantId), eq(policies.name, policyName)))
    .orderBy(desc(policies.version))
    .limit(1);
  return (row?.rules ?? []) as Rule[];
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
    const policyRules = await loadPolicyRules(ingested.tenantId, policyName);
    const result = evaluate(normalized, facts, policyRules, policyName);

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

    // allow — handoff; plan-03 adds capability issuance, plan-04 execution.
    return { ok: true, data };
  } catch (err) {
    if (err instanceof GatewayError) {
      return { ok: false, error: { code: err.code, message: err.message } };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: { code: "INTERNAL", message } };
  }
}
