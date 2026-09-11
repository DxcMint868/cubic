import { randomUUID as uuid } from "node:crypto";
import { db } from "../db/client";
import { auditEvents } from "../db/schema";
import { emitInput, payloadSchemas, type EmitInput, type EventEnvelope } from "./types";
import type { RiskClass } from "../domain";

// Meta is best-effort context for the plan-08 projection. Audit row is unaffected.
export interface ProjectionMeta {
  agent_key?: string;
  category?: string;
  risk_class?: RiskClass;
}

export async function emit(input: EmitInput, meta: ProjectionMeta = {}): Promise<EventEnvelope> {
  const parsed = emitInput.safeParse(input);
  if (!parsed.success) throw new Error(`invalid event envelope: ${parsed.error.message}`);
  const payloadCheck = payloadSchemas[parsed.data.event_type].safeParse(parsed.data.payload);
  if (!payloadCheck.success) throw new Error(`invalid payload for ${parsed.data.event_type}: ${payloadCheck.error.message}`);
  const envelope: EventEnvelope = {
    ...parsed.data,
    event_id: uuid(),
    occurred_at: new Date().toISOString(),
  };
  await db().insert(auditEvents).values({
    tenantId: envelope.tenant_id,
    taskId: envelope.task_id,
    agentId: envelope.agent_id,
    eventType: envelope.event_type,
    payload: envelope.payload,
  });
  void meta; // plan-08 wires the projection here; today it is accepted and ignored.
  return envelope;
}
