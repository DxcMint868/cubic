import { z } from "zod";

const _eventTypes = [
  "intent.created", "policy.evaluated", "capability.issued", "capability.denied",
  "capability.escalated", "capability.consumed", "capability.rejected",
  "ledger.approval.requested", "ledger.approval.completed",
  "payment.requested", "payment.completed", "payment.failed", "service.discovered",
  "tool.execution.started", "tool.execution.completed", "tool.execution.failed",
  "task.completed",
] as const;
export type EventType = (typeof _eventTypes)[number];
export const eventTypes: [EventType, ...EventType[]] = [..._eventTypes];

const uuid = z.string().uuid();
const risk = z.enum(["low", "medium", "high", "critical"]);
const dec = z.enum(["allow", "deny", "escalate"]);

export const payloadSchemas: Record<EventType, z.ZodTypeAny> = {
  "intent.created": z.object({ intent_id: uuid, tool: z.string(), resource: z.string().nullable().default(null), risk_class: risk, origin: z.enum(["agent", "payment_discovery"]) }),
  "policy.evaluated": z.object({ intent_id: uuid, decision_id: uuid, decision: dec, matched_policy: z.string(), matched_rule_id: z.string(), reason_codes: z.array(z.string()), risk_score: z.number().int() }),
  "capability.issued": z.object({ capability_id: uuid, decision_id: uuid, subject: z.string(), action: z.string(), resource: z.string(), budget_usd_cents: z.number().int().nullable(), expires_at: z.string(), nonce: z.string().length(64), policy_hash: z.string() }),
  "capability.denied": z.object({ intent_id: uuid, decision_id: uuid, reason_codes: z.array(z.string()) }),
  "capability.escalated": z.object({ intent_id: uuid, decision_id: uuid, approval_id: uuid, reason_codes: z.array(z.string()) }),
  "capability.consumed": z.object({ capability_id: uuid, execution_id: uuid.nullable() }),
  "capability.rejected": z.object({ capability_id: uuid.nullable(), reason: z.enum(["not_found", "replay", "expired", "action_mismatch", "resource_mismatch", "budget_exceeded"]), requested_action: z.string().nullable(), requested_resource: z.string().nullable() }),
  "ledger.approval.requested": z.object({ approval_id: uuid, decision_id: uuid, provider: z.enum(["dev", "ledger"]), action: z.string(), resource: z.string() }),
  "ledger.approval.completed": z.object({ approval_id: uuid, decision_id: uuid, provider: z.enum(["dev", "ledger"]), outcome: z.enum(["approved", "rejected"]) }),
  "payment.requested": z.object({ payment_id: uuid, capability_id: uuid, service: z.string(), network: z.literal("hedera"), amount_usd_cents: z.number().int() }),
  "payment.completed": z.object({ payment_id: uuid, capability_id: uuid, settlement_ref: z.string() }),
  "payment.failed": z.object({ payment_id: uuid, capability_id: uuid, error_code: z.string() }),
  "service.discovered": z.object({ intent_id: uuid, service: z.string(), price_usd_cents: z.number().int(), challenge_ref: z.string() }),
  "tool.execution.started": z.object({ execution_id: uuid, capability_id: uuid, tool: z.string(), resource: z.string() }),
  "tool.execution.completed": z.object({ execution_id: uuid, capability_id: uuid, result_summary: z.string() }),
  "tool.execution.failed": z.object({ execution_id: uuid, capability_id: uuid, error_code: z.string() }),
  "task.completed": z.object({ task_id: uuid, status: z.enum(["completed", "failed"]), summary: z.string().nullable() }),
};

export const emitInput = z.object({
  event_type: z.enum(eventTypes),
  tenant_id: uuid,
  task_id: uuid.nullable().default(null),
  agent_id: uuid.nullable().default(null),
  payload: z.record(z.string(), z.unknown()),
});
export type EmitInput = z.infer<typeof emitInput>;
export type EventEnvelope = EmitInput & { event_id: string; occurred_at: string };
