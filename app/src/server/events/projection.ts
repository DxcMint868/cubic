import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import {
  agents,
  approvals,
  capabilities,
  decisions,
  executions,
  intents,
  networkEvents,
  payments,
  tools,
} from "../db/schema";
import type { RiskClass } from "../domain";
import type { ProjectionMeta } from "./bus";
import type { EventEnvelope, EventType } from "./types";

// plan-08 EXACT — event_type → action_class. Only these event types project;
// anything unmapped is skipped (all 17 canonical types plus the plan-13
// sanctioned capability.revoked addendum are mapped).
export const ACTION_CLASS: Record<EventType, string> = {
  "intent.created": "intent",
  "policy.evaluated": "evaluation",
  "capability.issued": "authorization",
  "capability.denied": "authorization",
  "capability.escalated": "authorization",
  "capability.consumed": "authorization",
  "capability.rejected": "authorization",
  "capability.revoked": "authorization",
  "ledger.approval.requested": "approval",
  "ledger.approval.completed": "approval",
  "payment.requested": "payment",
  "payment.completed": "payment",
  "payment.failed": "payment",
  "service.discovered": "discovery",
  "tool.execution.started": "execution",
  "tool.execution.completed": "execution",
  "tool.execution.failed": "execution",
  "task.completed": "task",
};

// plan-08 EXACT — outcome per event type (payload-derived where noted).
export function outcomeFor(eventType: EventType, payload: Record<string, unknown>): string {
  switch (eventType) {
    case "intent.created":
      return "created";
    case "policy.evaluated":
      return String(payload.decision);
    case "capability.issued":
      return "issued";
    case "capability.denied":
      return "denied";
    case "capability.escalated":
      return "escalated";
    case "capability.consumed":
      return "consumed";
    case "capability.rejected":
      return String(payload.reason);
    case "capability.revoked":
      return "revoked";
    case "ledger.approval.requested":
      return "requested";
    case "ledger.approval.completed":
      return String(payload.outcome);
    case "payment.requested":
      return "requested";
    case "payment.completed":
      return "completed";
    case "payment.failed":
      return "failed";
    case "service.discovered":
      return "discovered";
    case "tool.execution.started":
      return "started";
    case "tool.execution.completed":
      return "succeeded";
    case "tool.execution.failed":
      return "failed";
    case "task.completed":
      return String(payload.status);
  }
}

export function pseudonymFor(agentKey: string): string {
  return createHash("sha256").update(`${agentKey}|cubic-network-v1`).digest("hex").slice(0, 16);
}

export type NetworkRow = typeof networkEvents.$inferSelect;

// plan-00 §G — the public row shape served by all three network routes.
export function publicShape(row: NetworkRow) {
  return {
    id: row.id,
    event_type: row.eventType,
    agent_pseudonym: row.agentPseudonym,
    agent_category: row.agentCategory,
    action_class: row.actionClass,
    outcome: row.outcome,
    risk_class: row.riskClass,
    created_at: row.createdAt,
  };
}

type IntentRow = typeof intents.$inferSelect;

async function intentForCapability(capabilityId: string): Promise<IntentRow | null> {
  const [cap] = await db().select().from(capabilities).where(eq(capabilities.id, capabilityId));
  if (!cap) return null;
  const [dec] = await db().select().from(decisions).where(eq(decisions.id, cap.decisionId));
  if (!dec) return null;
  const [intent] = await db().select().from(intents).where(eq(intents.id, dec.intentId));
  return intent ?? null;
}

// plan-08 EXACT — causal intent resolution order.
async function resolveIntent(payload: Record<string, unknown>): Promise<IntentRow | null> {
  const asId = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

  const directId = asId(payload.intent_id);
  if (directId) {
    const [intent] = await db().select().from(intents).where(eq(intents.id, directId));
    if (intent) return intent;
  }

  const capabilityId = asId(payload.capability_id);
  if (capabilityId) {
    const intent = await intentForCapability(capabilityId);
    if (intent) return intent;
  }

  const approvalId = asId(payload.approval_id);
  if (approvalId) {
    const [approval] = await db().select().from(approvals).where(eq(approvals.id, approvalId));
    if (approval) {
      const [dec] = await db().select().from(decisions).where(eq(decisions.id, approval.decisionId));
      if (dec) {
        const [intent] = await db().select().from(intents).where(eq(intents.id, dec.intentId));
        if (intent) return intent;
      }
    }
  }

  const executionId = asId(payload.execution_id);
  if (executionId) {
    const [execution] = await db().select().from(executions).where(eq(executions.id, executionId));
    if (execution) {
      const intent = await intentForCapability(execution.capabilityId);
      if (intent) return intent;
    }
  }

  const paymentId = asId(payload.payment_id);
  if (paymentId) {
    const [payment] = await db().select().from(payments).where(eq(payments.id, paymentId));
    if (payment) {
      const intent = await intentForCapability(payment.capabilityId);
      if (intent) return intent;
    }
  }

  return null;
}

type Listener = (row: NetworkRow) => void;

const listeners = new Set<Listener>();

// In-process live tail for the SSE route. Same-process only (single Next
// server); subscribers must never throw into the emit path.
export function subscribeNetwork(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function broadcast(row: NetworkRow): void {
  for (const listener of listeners) {
    try {
      listener(row);
    } catch {
      // A broken subscriber must not break emission; SSE cleanup removes it.
    }
  }
}

// plan-08 EXACT — field resolution order. Runs inside emit(); writes the
// allowlist-only row: never tool arguments, resource strings, prompts,
// tenant identity, or policy internals.
export async function projectEvent(
  envelope: EventEnvelope,
  meta: ProjectionMeta = {},
): Promise<NetworkRow | null> {
  const actionClass = ACTION_CLASS[envelope.event_type];
  if (!actionClass) return null;

  // agent_key = meta.agent_key → else agents row by envelope.agent_id → else skip.
  let agentKey = meta.agent_key;
  if (!agentKey && envelope.agent_id) {
    const [agent] = await db().select().from(agents).where(eq(agents.id, envelope.agent_id));
    agentKey = agent?.agentKey;
  }
  if (!agentKey) return null;

  const payload = envelope.payload as Record<string, unknown>;
  const intent = await resolveIntent(payload);

  // agent_category = meta.category → else the intent's tool row category → "control".
  let agentCategory = meta.category;
  if (!agentCategory && intent && envelope.tenant_id) {
    const [toolRow] = await db()
      .select()
      .from(tools)
      .where(and(eq(tools.tenantId, envelope.tenant_id), eq(tools.name, intent.tool)));
    agentCategory = toolRow?.category;
  }
  if (!agentCategory) agentCategory = "control";

  // risk_class = meta.risk_class → else the intent's risk_class → "low".
  const riskClass: RiskClass | "low" = meta.risk_class ?? (intent?.riskClass as RiskClass | undefined) ?? "low";

  const [row] = await db()
    .insert(networkEvents)
    .values({
      eventType: envelope.event_type,
      agentPseudonym: pseudonymFor(agentKey),
      agentCategory,
      actionClass,
      outcome: outcomeFor(envelope.event_type, payload),
      riskClass,
    })
    .returning();

  broadcast(row);
  return row;
}
