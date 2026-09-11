import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { capabilities, decisions, intents, tasks } from "../db/schema";
import { emit } from "../events/bus";

export type ConsumeResult =
  | { status: "consumed"; capability_id: string }
  | { status: "rejected"; reason: "not_found" | "replay" | "expired" | "action_mismatch" | "resource_mismatch" | "budget_exceeded" };

export interface ConsumeRequest {
  action: string;
  resource: string;
  amount?: number;
}

type CapabilityRow = typeof capabilities.$inferSelect;

async function emitRejected(
  row: CapabilityRow | null,
  reason: Exclude<ConsumeResult, { status: "consumed" }>["reason"],
  req: ConsumeRequest,
): Promise<void> {
  // not_found has no row and therefore no tenant/task/agent chain to attribute
  // the audit event to (tenant_id is required) — it returns without emitting.
  if (!row) return;
  const [decisionRow] = await db().select().from(decisions).where(eq(decisions.id, row.decisionId));
  const [intentRow] = decisionRow
    ? await db().select().from(intents).where(eq(intents.id, decisionRow.intentId))
    : [];
  const [taskRow] = intentRow?.taskId
    ? await db().select().from(tasks).where(eq(tasks.id, intentRow.taskId))
    : [];
  if (!taskRow || !intentRow) return;
  await emit(
    {
      event_type: "capability.rejected",
      tenant_id: taskRow.tenantId,
      task_id: intentRow.taskId,
      agent_id: intentRow.agentId,
      payload: {
        capability_id: row.id,
        reason,
        requested_action: req.action,
        requested_resource: req.resource,
      },
    },
    { agent_key: row.subject },
  );
}

// Read-only checks 1–6 in the EXACT order (no atomic update, no events).
// Shared by consumeCapability and the verify-capability route.
async function check16(
  capabilityId: string,
  req: ConsumeRequest,
): Promise<{ row: CapabilityRow | null; rejected: Extract<ConsumeResult, { status: "rejected" }> | null }> {
  const [row] = await db().select().from(capabilities).where(eq(capabilities.id, capabilityId));
  if (!row) {
    return { row: null, rejected: { status: "rejected", reason: "not_found" } };
  }
  if (new Date(row.expiresAt) <= new Date()) {
    if (row.status === "issued") {
      await db().update(capabilities).set({ status: "expired" }).where(
        and(eq(capabilities.id, row.id), eq(capabilities.status, "issued")),
      );
    }
    return { row, rejected: { status: "rejected", reason: "expired" } };
  }
  if (row.status !== "issued") {
    return { row, rejected: { status: "rejected", reason: "replay" } };
  }
  if (req.action !== row.action) {
    return { row, rejected: { status: "rejected", reason: "action_mismatch" } };
  }
  if (req.resource !== row.resource) {
    return { row, rejected: { status: "rejected", reason: "resource_mismatch" } };
  }
  if (req.amount != null && (row.budgetUsdCents == null || req.amount > row.budgetUsdCents)) {
    return { row, rejected: { status: "rejected", reason: "budget_exceeded" } };
  }
  return { row, rejected: null };
}

export async function consumeCapability(
  capabilityId: string,
  req: { action: string; resource: string; amount?: number },
): Promise<ConsumeResult> {
  const { row, rejected } = await check16(capabilityId, req);
  if (rejected) {
    await emitRejected(row, rejected.reason, req);
    return rejected;
  }
  const target = row!;
  const updated = await db()
    .update(capabilities)
    .set({ status: "consumed", consumedAt: new Date().toISOString() })
    .where(and(eq(capabilities.id, target.id), eq(capabilities.status, "issued")))
    .returning({ id: capabilities.id });
  if (updated.length === 0) {
    await emitRejected(target, "replay", req);
    return { status: "rejected", reason: "replay" };
  }
  const [decisionRow] = await db().select().from(decisions).where(eq(decisions.id, target.decisionId));
  const [intentRow] = decisionRow
    ? await db().select().from(intents).where(eq(intents.id, decisionRow.intentId))
    : [];
  const [taskRow] = intentRow?.taskId
    ? await db().select().from(tasks).where(eq(tasks.id, intentRow.taskId))
    : [];
  if (taskRow && intentRow) {
    await emit(
      {
        event_type: "capability.consumed",
        tenant_id: taskRow.tenantId,
        task_id: intentRow.taskId,
        agent_id: intentRow.agentId,
        payload: { capability_id: target.id, execution_id: null },
      },
      { agent_key: target.subject },
    );
  }
  return { status: "consumed", capability_id: target.id };
}

// Non-consuming introspection for executors/tests: checks 1–6 only,
// no atomic update, no events.
export async function verifyCapability(
  capabilityId: string,
  req: { action: string; resource: string; amount?: number },
): Promise<{ status: "issued" } | { status: "rejected"; reason: Exclude<ConsumeResult, { status: "consumed" }>["reason"] }> {
  const { rejected } = await check16(capabilityId, req);
  if (rejected) return { status: "rejected", reason: rejected.reason };
  return { status: "issued" };
}

export async function revokeCapability(capabilityId: string): Promise<boolean> {
  const updated = await db()
    .update(capabilities)
    .set({ status: "revoked" })
    .where(and(eq(capabilities.id, capabilityId), eq(capabilities.status, "issued")))
    .returning({ id: capabilities.id });
  return updated.length > 0;
}
