import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, count } from "drizzle-orm";
import { db } from "../src/server/db/client";
import { tenants, auditEvents } from "../src/server/db/schema";
import { emit } from "../src/server/events/bus";
import { emitInput, eventTypes } from "../src/server/events/types";

let tenantId: string;

const samples: Record<string, Record<string, unknown>> = {
  "intent.created": { intent_id: randomUUID(), tool: "scanner.scan", resource: "acme/backend", risk_class: "medium", origin: "agent" },
  "policy.evaluated": { intent_id: randomUUID(), decision_id: randomUUID(), decision: "allow", matched_policy: "default-v1", matched_rule_id: "default-allow", reason_codes: ["policy_default_allow"], risk_score: 10 },
  "capability.issued": { capability_id: randomUUID(), decision_id: randomUUID(), subject: "agent:8472", action: "read_file", resource: "acme/backend/README.md", budget_usd_cents: null, expires_at: new Date().toISOString(), nonce: "a".repeat(64), policy_hash: "b".repeat(64) },
  "capability.denied": { intent_id: randomUUID(), decision_id: randomUUID(), reason_codes: ["secret_resource"] },
  "capability.escalated": { intent_id: randomUUID(), decision_id: randomUUID(), approval_id: randomUUID(), reason_codes: ["risk_requires_approval"] },
  "capability.consumed": { capability_id: randomUUID(), execution_id: null },
  "capability.rejected": { capability_id: null, reason: "expired", requested_action: null, requested_resource: null },
  "ledger.approval.requested": { approval_id: randomUUID(), decision_id: randomUUID(), provider: "dev", action: "merge_pull_request", resource: "acme/backend#421" },
  "ledger.approval.completed": { approval_id: randomUUID(), decision_id: randomUUID(), provider: "dev", outcome: "approved" },
  "payment.requested": { payment_id: randomUUID(), capability_id: randomUUID(), service: "scanner", network: "hedera", amount_usd_cents: 25 },
  "payment.completed": { payment_id: randomUUID(), capability_id: randomUUID(), settlement_ref: "tx-1" },
  "payment.failed": { payment_id: randomUUID(), capability_id: randomUUID(), error_code: "settlement_timeout" },
  "service.discovered": { intent_id: randomUUID(), service: "scanner", price_usd_cents: 25, challenge_ref: "ch-1" },
  "tool.execution.started": { execution_id: randomUUID(), capability_id: randomUUID(), tool: "scanner.scan", resource: "acme/backend" },
  "tool.execution.completed": { execution_id: randomUUID(), capability_id: randomUUID(), result_summary: "report" },
  "tool.execution.failed": { execution_id: randomUUID(), capability_id: randomUUID(), error_code: "executor_error" },
  "task.completed": { task_id: randomUUID(), status: "completed", summary: null },
};

const auditCount = async () =>
  Number((await db().select({ value: count() }).from(auditEvents).where(eq(auditEvents.tenantId, tenantId)))[0].value);

beforeAll(async () => {
  const [row] = await db()
    .insert(tenants)
    .values({ slug: "test-plan-01", name: "test-plan-01 throwaway" })
    .onConflictDoUpdate({ target: tenants.slug, set: { name: "test-plan-01 throwaway" } })
    .returning();
  tenantId = row.id;
});

afterAll(async () => {
  await db().delete(auditEvents).where(eq(auditEvents.tenantId, tenantId));
  await db().delete(tenants).where(eq(tenants.id, tenantId));
});

describe("emit", () => {
  it("every one of the 17 event types has a sample", () => {
    expect([...eventTypes]).toHaveLength(17);
    expect(Object.keys(samples).sort()).toEqual([...eventTypes].sort());
  });

  it.each(Object.keys(samples))("persists and validates envelope for %s", async (eventType) => {
    const envelope = await emit({
      event_type: eventType as never,
      tenant_id: tenantId,
      task_id: null,
      agent_id: null,
      payload: samples[eventType],
    });
    expect(envelope.event_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(envelope.occurred_at).getTime()).not.toBeNaN();
    expect(emitInput.safeParse({
      event_type: envelope.event_type,
      tenant_id: envelope.tenant_id,
      task_id: envelope.task_id,
      agent_id: envelope.agent_id,
      payload: envelope.payload,
    }).success).toBe(true);
  });

  it("invalid payload throws and writes no row", async () => {
    const before = await auditCount();
    await expect(
      emit({
        event_type: "policy.evaluated",
        tenant_id: tenantId,
        task_id: null,
        agent_id: null,
        payload: { intent_id: "not-a-uuid" } as never,
      }),
    ).rejects.toThrow(/invalid payload for policy\.evaluated/);
    expect(await auditCount()).toBe(before);
  });
});
