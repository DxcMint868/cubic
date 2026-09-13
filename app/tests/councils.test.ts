// Council multisig tests — throwaway tenant test-plan-councils.
// treasury-council is seeded 2-of-2 (owner + client): one signature collects
// (202), the second completes; non-members 403; member reject vetoes at once.
// Also covers rule→council assignment and the HCS verify route (mocked mirror).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { privateKeyToAccount } from "viem/accounts";
import { db } from "../src/server/db/client";
import {
  agents, approvals, auditEvents, capabilities, councils, decisions, executions,
  intents, networkEvents, payments, policies, tasks, tenants, tools,
} from "../src/server/db/schema";
import { runToolCall } from "../src/server/gateway/orchestrator";
import { seed } from "../src/server/demo/seed";
import { POST as resolvePOST } from "../src/app/api/approvals/[id]/resolve/route";
import { GET as councilsGET, POST as councilsPOST } from "../src/app/api/console/councils/route";
import { GET as policyDocsGET } from "../src/app/api/console/policies/route";
import { PUT as assignPUT } from "../src/app/api/console/policies/[...path]/route";
import { GET as verifyGET } from "../src/app/api/anchors/verify/route";
import { fingerprint } from "../src/server/anchors/hcs";
import { approvalSignMessage } from "../src/lib/approval-message";
import type { Rule } from "../src/server/gateway/policy/engine";

vi.hoisted(() => {
  process.env.DEMO_TENANT_SLUG = "test-plan-councils";
});

const TENANT = "test-plan-councils";
const hasKeys = Boolean(process.env.AGENT_OWNER_KEY && process.env.AGENT_CLIENT_KEY);

const TREASURY_TOOLS = [
  { name: "treasury.swap", category: "treasury", defaultRiskClass: "high", executor: "treasury", executorConfig: {} },
  { name: "treasury.transfer", category: "treasury", defaultRiskClass: "high", executor: "treasury", executorConfig: {} },
  { name: "treasury.stake", category: "treasury", defaultRiskClass: "medium", executor: "treasury", executorConfig: {} },
] as const;

let tenantId = "";
let taskId = "";

function resolve(id: string, body: Record<string, unknown>) {
  return resolvePOST(
    new Request("http://test/api/approvals/x/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

function ownerAccount() {
  return privateKeyToAccount(process.env.AGENT_OWNER_KEY as `0x${string}`);
}

function clientAccount() {
  return privateKeyToAccount(process.env.AGENT_CLIENT_KEY as `0x${string}`);
}

async function escalateSwap(): Promise<string> {
  const r = await runToolCall({
    task_id: taskId,
    agent_key: "agent:treasury",
    tool: "treasury.swap",
    arguments: { asset_pair: "USDC/ETH", amount_usd_cents: 24_000_000 },
  });
  if (!r.ok || r.data.decision !== "escalate" || !r.data.approval_id) {
    throw new Error(`setup failed: ${JSON.stringify(r)}`);
  }
  return r.data.approval_id;
}

beforeAll(async () => {
  await seed();
  const [tenant] = await db().select().from(tenants).where(eq(tenants.slug, TENANT));
  tenantId = tenant.id;

  await db().insert(tools).values(
    TREASURY_TOOLS.map((t) => ({
      tenantId,
      name: t.name,
      category: t.category,
      defaultRiskClass: t.defaultRiskClass,
      executor: t.executor,
      executorConfig: { ...t.executorConfig },
    })),
  );
  const [policy] = await db()
    .select()
    .from(policies)
    .where(and(eq(policies.tenantId, tenantId), eq(policies.name, "default-v1")));
  const rules = [...(policy.rules as Rule[])];
  const at = rules.findIndex((r) => r.id === "tool-allowlist");
  rules[at] = { ...rules[at], tools: [...(rules[at].tools ?? []), ...TREASURY_TOOLS.map((t) => t.name)] };
  await db().update(policies).set({ rules }).where(eq(policies.id, policy.id));

  const [tagent] = await db()
    .select()
    .from(agents)
    .where(and(eq(agents.tenantId, tenantId), eq(agents.agentKey, "agent:treasury")));
  const have = (tagent.declaredCapabilities ?? []) as string[];
  await db()
    .update(agents)
    .set({ declaredCapabilities: [...have, ...TREASURY_TOOLS.map((t) => t.name).filter((n) => !have.includes(n))] })
    .where(eq(agents.id, tagent.id));

  const [task] = await db()
    .insert(tasks)
    .values({ tenantId, agentId: tagent.id, title: "council test task", budgetUsdCents: 100_000_000, status: "open" })
    .returning();
  taskId = task.id;
}, 120000);

afterAll(async () => {
  const [t] = await db().select().from(tenants).where(eq(tenants.slug, TENANT));
  if (t) {
    const tagents = await db().select().from(agents).where(eq(agents.tenantId, t.id));
    const agentIds = tagents.map((a) => a.id);
    if (agentIds.length) {
      const intentIds = (
        await Promise.all(
          agentIds.map((id) => db().select().from(intents).where(eq(intents.agentId, id))),
        )
      ).flat().map((i) => i.id);
      if (intentIds.length) {
        const tdec = (
          await Promise.all(
            intentIds.map((id) => db().select().from(decisions).where(eq(decisions.intentId, id))),
          )
        ).flat();
        const decIds = tdec.map((d) => d.id);
        if (decIds.length) {
          const tcaps = (
            await Promise.all(
              decIds.map((id) => db().select().from(capabilities).where(eq(capabilities.decisionId, id))),
            )
          ).flat();
          for (const c of tcaps) {
            await db().delete(executions).where(eq(executions.capabilityId, c.id));
            await db().delete(payments).where(eq(payments.capabilityId, c.id));
          }
          for (const id of decIds) {
            await db().delete(approvals).where(eq(approvals.decisionId, id));
            await db().delete(capabilities).where(eq(capabilities.decisionId, id));
          }
        }
        for (const id of intentIds) await db().delete(decisions).where(eq(decisions.intentId, id));
      }
      for (const id of agentIds) await db().delete(intents).where(eq(intents.agentId, id));
    }
    await db().delete(auditEvents).where(eq(auditEvents.tenantId, t.id));
    await db().delete(tasks).where(eq(tasks.tenantId, t.id));
    await db().delete(agents).where(eq(agents.tenantId, t.id));
    await db().delete(tools).where(eq(tools.tenantId, t.id));
    await db().delete(policies).where(eq(policies.tenantId, t.id));
    await db().delete(councils).where(eq(councils.tenantId, t.id));
    await db().delete(tenants).where(eq(tenants.id, t.id));
  }
  for (const key of ["agent:8472", "agent:treasury", "agent:reader", "agent:lab-1"]) {
    const pseudo = createHash("sha256").update(`${key}|cubic-network-v1`).digest("hex").slice(0, 16);
    await db().delete(networkEvents).where(eq(networkEvents.agentPseudonym, pseudo));
  }
  delete process.env.DEMO_TENANT_SLUG;
  delete (globalThis as Record<string, unknown>).__cubicConfig;
}, 120000);

describe("council threshold (treasury-council multisig)", () => {
  it.skipIf(!hasKeys)("first member collects (202), second completes", async () => {
    // Threshold follows seeded membership (1 when a lone key, 2 when both).
    const list = (await (await councilsGET()).json()) as {
      ok: boolean;
      data: Array<{ name: string; threshold: number }>;
    };
    const threshold = list.data.find((c) => c.name === "treasury-council")!.threshold;
    expect([1, 2]).toContain(threshold);

    const approvalId = await escalateSwap();
    const owner = ownerAccount();

    const first = await resolve(approvalId, {
      outcome: "approved",
      signature: await owner.signMessage({ message: approvalSignMessage(approvalId, "approved") }),
      signer: owner.address,
    });
    if (threshold === 1) {
      const done = (await first.json()) as {
        ok: boolean;
        data: { capability: { action: string } | null; execution: { status: string } | null };
      };
      expect(done.ok).toBe(true);
      expect(done.data.capability?.action).toBe("treasury_swap");
      expect(done.data.execution?.status).toBe("succeeded");
      return;
    }
    expect(first.status).toBe(202);
    const collecting = (await first.json()) as {
      ok: boolean;
      data: { status: string; council: string; threshold: number; collected: number };
    };
    expect(collecting.data).toMatchObject({ status: "collecting", council: "treasury-council", threshold: 2, collected: 1 });

    // Second member completes (threshold 2 implies the client key exists).
    const client = clientAccount();
    const second = await resolve(approvalId, {
      outcome: "approved",
      signature: await client.signMessage({ message: approvalSignMessage(approvalId, "approved") }),
      signer: client.address,
    });
    const done = (await second.json()) as {
      ok: boolean;
      data: { capability: { action: string } | null; execution: { status: string } | null };
    };
    expect(done.ok).toBe(true);
    expect(done.data.capability?.action).toBe("treasury_swap");
    expect(done.data.execution?.status).toBe("succeeded");

    const [row] = await db().select().from(approvals).where(eq(approvals.id, approvalId));
    expect(((row.signatures ?? []) as Array<unknown>)).toHaveLength(2);
  }, 120000);

  it.skipIf(!hasKeys)("member reject vetoes at once, no second signature needed", async () => {
    const approvalId = await escalateSwap();
    // Any seeded member's reject vetoes at once (threshold-independent).
    const list = (await (await councilsGET()).json()) as {
      ok: boolean;
      data: Array<{ name: string; members: string[] }>;
    };
    const member = list.data.find((c) => c.name === "treasury-council")!.members[0];
    const signer =
      member.toLowerCase() === ownerAccount().address.toLowerCase() ? ownerAccount() : clientAccount();
    const res = await resolve(approvalId, {
      outcome: "rejected",
      signature: await signer.signMessage({ message: approvalSignMessage(approvalId, "rejected") }),
      signer: signer.address,
    });
    const body = (await res.json()) as { ok: boolean; data: { approval_outcome: string; capability: null; execution: null } };
    expect(body.ok).toBe(true);
    expect(body.data.approval_outcome).toBe("rejected");
    expect(body.data.capability).toBeNull();
    expect(body.data.execution).toBeNull();
  }, 120000);
});

describe("council registry + rule assignment APIs", () => {
  it("GET councils lists the seeded roster; POST creates; duplicates 409", async () => {
    const list = (await (await councilsGET()).json()) as {
      ok: boolean;
      data: Array<{ name: string; members: string[]; threshold: number; safe_address: string | null }>;
    };
    expect(list.ok).toBe(true);
    const names = list.data.map((c) => c.name);
    expect(names).toContain("treasury-council");
    expect(names).toContain("deploy-council");
    const treasury = list.data.find((c) => c.name === "treasury-council")!;
    // Threshold follows seeded membership (1-of-1 with a lone key, 2-of-2 with both).
    expect([1, 2]).toContain(treasury.threshold);
    expect(treasury.safe_address).toBeNull();

    const created = await councilsPOST(
      new Request("http://test/api/console/councils", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "test-council",
          members: ["0x0000000000000000000000000000000000000001", "0x0000000000000000000000000000000000000002"],
          threshold: 2,
        }),
      }),
    );
    expect(created.status).toBe(200);

    const dupe = await councilsPOST(
      new Request("http://test/api/console/councils", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "test-council", members: ["0x0000000000000000000000000000000000000001"], threshold: 1 }),
      }),
    );
    expect(dupe.status).toBe(409);

    const bad = await councilsPOST(
      new Request("http://test/api/console/councils", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "bad", members: ["not-an-address"], threshold: 1 }),
      }),
    );
    expect(bad.status).toBe(400);
  }, 60000);

  it("rule→council assignment round-trips through policy docs", async () => {
    const docs = (await (await policyDocsGET()).json()) as {
      ok: boolean;
      data: Array<{ name: string; rules: Array<{ id: string; council: string | null }> }>;
    };
    const def = docs.data.find((d) => d.name === "default-v1")!;
    expect(def.rules.find((r) => r.id === "risk-approval")?.council).toBe("treasury-council");

    const res = await assignPUT(
      new Request("http://test/api/console/policies/default-v1/rules/risk-approval", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ council: "test-council" }),
      }),
      { params: Promise.resolve({ path: ["default-v1", "rules", "risk-approval"] }) },
    );
    const body = (await res.json()) as { ok: boolean; data: { council: string | null } };
    expect(body.ok).toBe(true);
    expect(body.data.council).toBe("test-council");

    const back = await assignPUT(
      new Request("http://test/api/console/policies/default-v1/rules/risk-approval", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ council: "treasury-council" }),
      }),
      { params: Promise.resolve({ path: ["default-v1", "rules", "risk-approval"] }) },
    );
    expect(((await back.json()) as { ok: boolean }).ok).toBe(true);

    const unknown = await assignPUT(
      new Request("http://test/api/console/policies/default-v1/rules/risk-approval", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ council: "nope" }),
      }),
      { params: Promise.resolve({ path: ["default-v1", "rules", "risk-approval"] }) },
    );
    expect(unknown.status).toBe(400);
  }, 60000);
});

describe("HCS verify route (mocked mirror)", () => {
  it.skipIf(!process.env.HCS_TOPIC_ID)("reports per-event verification against mirror messages", async () => {
    await runToolCall({
      task_id: taskId,
      agent_key: "agent:treasury",
      tool: "treasury.stake",
      arguments: { protocol: "lido", amount_usd_cents: 5_000 },
    });
    const rows = await db().select().from(auditEvents).where(eq(auditEvents.taskId, taskId));
    expect(rows.length).toBeGreaterThan(0);
    const target = rows.find((r) => r.eventType === "policy.evaluated") ?? rows[0];
    const targetFp = fingerprint({
      event_type: target.eventType,
      payload: (target.payload ?? {}) as Record<string, unknown>,
    });

    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async () =>
      Response.json({ messages: [{ message: targetFp }, { message: "deadbeef" }], links: { next: null } }),
    );
    try {
      const res = await verifyGET(new Request(`http://test/api/anchors/verify?task_id=${taskId}`));
      const body = (await res.json()) as {
        ok: boolean;
        data: { verified_count: number; total: number; events: Array<{ fingerprint: string; verified: boolean }> };
      };
      expect(body.ok).toBe(true);
      expect(body.data.events.find((e) => e.fingerprint === targetFp)?.verified).toBe(true);
      expect(body.data.events.find((e) => e.fingerprint === "deadbeef")).toBeUndefined();
      expect(body.data.verified_count).toBe(1);
    } finally {
      vi.stubGlobal("fetch", realFetch);
    }
  }, 60000);
});
