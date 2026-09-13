import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { eq, count } from "drizzle-orm";
import { db } from "../src/server/db/client";
import { tenants, agents, tasks, auditEvents, networkEvents } from "../src/server/db/schema";
import { seed } from "../src/server/demo/seed";

const pseudonym = (agentKey: string) =>
  createHash("sha256").update(`${agentKey}|cubic-network-v1`).digest("hex").slice(0, 16);

const FOREIGN_PSEUDO = "foreign-pseudo-not-cubic";

let foreignTenantId: string;
let foreignAgentId: string;

async function firstCount(
  rows: { value: number }[],
): Promise<number> {
  return Number(rows[0]?.value ?? 0);
}

async function demoCounts() {
  const [demo] = await db().select().from(tenants).where(eq(tenants.slug, "demo"));
  if (!demo) return { agents: 0, audits: 0 };
  return {
    agents: await firstCount(
      await db().select({ value: count() }).from(agents).where(eq(agents.tenantId, demo.id)),
    ),
    audits: await firstCount(
      await db().select({ value: count() }).from(auditEvents).where(eq(auditEvents.tenantId, demo.id)),
    ),
  };
}

async function foreignRows() {
  const agentRows = await db()
    .select()
    .from(agents)
    .where(eq(agents.agentKey, "agent:test-foreign"));
  const auditRows = await db()
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.tenantId, foreignTenantId));
  const networkRows = await db()
    .select()
    .from(networkEvents)
    .where(eq(networkEvents.agentPseudonym, FOREIGN_PSEUDO));
  return { agentRows, auditRows, networkRows };
}

beforeAll(async () => {
  const [foreign] = await db()
    .insert(tenants)
    .values({ slug: "test-plan-01", name: "test-plan-01 throwaway" })
    .onConflictDoUpdate({ target: tenants.slug, set: { name: "test-plan-01 throwaway" } })
    .returning();
  foreignTenantId = foreign.id;
  const [foreignAgent] = await db()
    .insert(agents)
    .values({ tenantId: foreignTenantId, agentKey: "agent:test-foreign", name: "foreign-agent" })
    .returning();
  foreignAgentId = foreignAgent.id;
});

afterAll(async () => {
  await db().delete(auditEvents).where(eq(auditEvents.agentId, foreignAgentId));
  await db().delete(agents).where(eq(agents.id, foreignAgentId));
  await db().delete(tenants).where(eq(tenants.id, foreignTenantId));
  await db().delete(networkEvents).where(eq(networkEvents.agentPseudonym, FOREIGN_PSEUDO));

  const [demo] = await db().select().from(tenants).where(eq(tenants.slug, "demo"));
  if (demo) {
    await db().delete(auditEvents).where(eq(auditEvents.tenantId, demo.id));
    await db().delete(tasks).where(eq(tasks.tenantId, demo.id));
    await db().delete(agents).where(eq(agents.tenantId, demo.id));
    await db().delete(networkEvents).where(eq(networkEvents.agentPseudonym, pseudonym("agent:8472")));
  }
});

describe("seed", () => {
  it("is idempotent and never touches foreign tenants", async () => {
    const beforeDemo = await demoCounts();
    const beforeForeign = await foreignRows();

    const result1 = await seed();
    const mid = await demoCounts();
    await seed();
    const afterDemo = await demoCounts();

    expect(result1.agents).toBe(4); // agent:8472 + agent:lab-1 + agent:treasury + agent:reader
    expect(result1.tools).toBe(6);
    expect(result1.policies).toBe(3);
    expect(result1.tasks).toBe(1);
    expect(afterDemo).toEqual(mid);
    expect(afterDemo.agents).toBe(2);

    const afterForeign = await foreignRows();
    expect(afterForeign.agentRows).toEqual(beforeForeign.agentRows);
    expect(afterForeign.auditRows.length).toBeGreaterThanOrEqual(beforeForeign.auditRows.length);
    expect(afterForeign.networkRows).toEqual(beforeForeign.networkRows);
  }, 30000);

  it("deletes demo network_events only by demo pseudonym", async () => {
    const demoPseudo = pseudonym("agent:8472");
    await db().insert(networkEvents).values({
      eventType: "tool.execution.completed",
      agentPseudonym: demoPseudo,
      agentCategory: "demo",
      actionClass: "execute",
      outcome: "succeeded",
      riskClass: "low",
    });
    await db().insert(networkEvents).values({
      eventType: "tool.execution.completed",
      agentPseudonym: FOREIGN_PSEUDO,
      agentCategory: "foreign",
      actionClass: "execute",
      outcome: "succeeded",
      riskClass: "low",
    });

    await seed();

    const demoRows = await db()
      .select()
      .from(networkEvents)
      .where(eq(networkEvents.agentPseudonym, demoPseudo));
    const foreignRowsLeft = await db()
      .select()
      .from(networkEvents)
      .where(eq(networkEvents.agentPseudonym, FOREIGN_PSEUDO));
    expect(demoRows).toEqual([]);
    expect(foreignRowsLeft.length).toBeGreaterThanOrEqual(1);
  });
});
