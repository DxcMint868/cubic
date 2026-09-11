import { randomBytes, createHash } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { approvals, capabilities, decisions, intents, tasks } from "../db/schema";
import type { DecisionResult, IssuedCapability } from "../domain";
import { emit } from "../events/bus";

// Recursive key sort, no spaces — the canonical JSON for policy_hash
// (plan-02's orchestrator reuses this same helper for the facts snapshot hash).
export function canonicalize(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(canonicalize).join(",") + "]";
  if (v && typeof v === "object") {
    return "{" + Object.keys(v as Record<string, unknown>).sort()
      .map((k) => JSON.stringify(k) + ":" + canonicalize((v as Record<string, unknown>)[k])).join(",") + "}";
  }
  return JSON.stringify(v);
}

export function canonicalPolicyJson(policy: { name: string; version: number; rules: unknown[] }): string {
  return canonicalize(policy);
}

export interface IssueInput {
  decision: DecisionResult;          // from evaluate()
  decisionId: string;                // the persisted decisions row id
  intent: { tool: string; action: string; resource: string; amount_usd_cents?: number; agent_key: string };
  policy: { name: string; version: number; rules: unknown[] };   // the selected rule document
}

export async function issueCapability(input: IssueInput): Promise<IssuedCapability> {
  const { decision, decisionId, intent, policy } = input;
  if (decision.decision === "allow") { /* proceed */ }
  else if (decision.decision === "escalate") {
    const [approval] = await db().select().from(approvals)
      .where(eq(approvals.decisionId, decisionId))
      .orderBy(desc(approvals.requestedAt)).limit(1);
    if (!approval || approval.status !== "approved") {
      throw new Error("capability gate: escalate decision without an approved approval");
    }
  } else {
    throw new Error("capability gate: cannot issue from a deny decision");
  }
  const row = {
    decisionId,
    subject: intent.agent_key,
    action: intent.action,
    resource: intent.resource,
    constraints: {},
    budgetUsdCents: intent.amount_usd_cents ?? null,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),   // fixed 5m TTL, every risk class
    nonce: randomBytes(32).toString("hex"),                          // 64 hex chars
    policyHash: createHash("sha256").update(canonicalPolicyJson(policy)).digest("hex"),
    status: "issued" as const,
  };

  // Resolve the audit chain BEFORE inserting — a missing link throws here,
  // leaving no orphan capability row behind.
  const [decisionRow] = await db().select().from(decisions).where(eq(decisions.id, decisionId));
  if (!decisionRow) throw new Error(`capability issue: decision row missing ${decisionId}`);
  const [intentRow] = await db().select().from(intents).where(eq(intents.id, decisionRow.intentId));
  if (!intentRow) throw new Error(`capability issue: intent row missing ${decisionRow.intentId}`);
  if (!intentRow.taskId) throw new Error(`capability issue: intent ${intentRow.id} has no task`);
  const [taskRow] = await db().select().from(tasks).where(eq(tasks.id, intentRow.taskId));
  if (!taskRow) throw new Error(`capability issue: task row missing ${intentRow.taskId}`);

  const [inserted] = await db().insert(capabilities).values(row).returning();

  const riskClass = decision.risk_score === 10 ? "low"
    : decision.risk_score === 40 ? "medium"
    : decision.risk_score === 70 ? "high" : "critical";
  await emit(
    {
      event_type: "capability.issued",
      tenant_id: taskRow.tenantId,
      task_id: intentRow.taskId,
      agent_id: intentRow.agentId,
      payload: {
        capability_id: inserted.id,
        decision_id: decisionId,
        subject: inserted.subject,
        action: inserted.action,
        resource: inserted.resource,
        budget_usd_cents: inserted.budgetUsdCents,
        expires_at: inserted.expiresAt,
        nonce: inserted.nonce,
        policy_hash: inserted.policyHash,
      },
    },
    { agent_key: inserted.subject, risk_class: riskClass },
  );

  return {
    capability_id: inserted.id,
    subject: inserted.subject,
    action: inserted.action,
    resource: inserted.resource,
    constraints: inserted.constraints as Record<string, unknown>,
    budget_usd_cents: inserted.budgetUsdCents,
    expires_at: inserted.expiresAt,
    nonce: inserted.nonce,
    policy_hash: inserted.policyHash,
  };
}
