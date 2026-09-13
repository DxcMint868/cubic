// plan-11 treasury + reasoning tests — throwaway tenant test-plan-11 seeded
// with the EXACT demo fixtures, then extended in-test with the treasury
// branch (tools, allowlist append, capabilities, treasury task). seed() itself
// is untouched (its exact counts are asserted by seed.test.ts), so this file
// can neither break the demo tenant nor any latest-open-task lookup.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../src/server/db/client";
import {
  agents, approvals, auditEvents, capabilities, councils, decisions, executions,
  intents, networkEvents, payments, policies, tasks, tenants, tools,
} from "../src/server/db/schema";
import { createHash } from "node:crypto";
import { runToolCall } from "../src/server/gateway/orchestrator";
import type { Rule } from "../src/server/gateway/policy/engine";
import { extractReasoningRef } from "../src/server/reasoning/langsmith";
import { seed } from "../src/server/demo/seed";
import { POST as resolvePOST } from "../src/app/api/approvals/[id]/resolve/route";
import { GET as traceGET } from "../src/app/api/audit/trace/[taskId]/route";

vi.hoisted(() => {
  process.env.DEMO_TENANT_SLUG = "test-plan-11";
});

const TENANT = "test-plan-11";
// Unique agent key (own network pseudonym — never the demo agent's), so this
// file's projected events cannot pollute the shared-DB demo pseudonym.
const TAGENT = "agent:treasury-1";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Fixture reference rate for narration: $100/ETH — deterministic, not a
// market quote. 0.5 ETH ≈ $50 (below the $100 stake threshold → allow),
// 50 ETH ≈ $5,000 (above → escalate).
const TREASURY_TOOLS = [
  { name: "treasury.swap", category: "treasury", default_risk_class: "high", executor: "treasury", executor_config: {} },
  { name: "treasury.transfer", category: "treasury", default_risk_class: "high", executor: "treasury", executor_config: {} },
  { name: "treasury.stake", category: "treasury", default_risk_class: "medium", executor: "treasury", executor_config: {} },
] as const;

let tenantId = "";
let treasuryAgentId = "";
let treasuryTaskId = "";

function call(taskId: string, tool: string, args: Record<string, unknown>) {
  return runToolCall({ task_id: taskId, agent_key: TAGENT, tool, arguments: args });
}

function resolve(approvalId: string, outcome: "approved" | "rejected") {
  return resolvePOST(
    new Request("http://test/api/approvals/x/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outcome }),
    }),
    { params: Promise.resolve({ id: approvalId }) },
  );
}

// Same env-swap idiom as e2e.demo.test.ts: config() is a lazy singleton, so
// dropping its cache around the swap re-parses process.env. Serial file — no
// concurrent test can observe the swap.
async function withEnv<T>(vars: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    process.env[k] = v;
  }
  delete (globalThis as Record<string, unknown>).__cubicConfig;
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    delete (globalThis as Record<string, unknown>).__cubicConfig;
  }
}

beforeAll(async () => {
  await seed(); // seeds the test-plan-11 tenant (slug override), demo untouched
  const [tenant] = await db().select().from(tenants).where(eq(tenants.slug, TENANT));
  tenantId = tenant.id;

  await db().insert(tools).values(
    TREASURY_TOOLS.map((t) => ({
      tenantId,
      name: t.name,
      category: t.category,
      defaultRiskClass: t.default_risk_class,
      executor: t.executor,
      executorConfig: { ...t.executor_config },
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
    .insert(agents)
    .values({
      tenantId,
      agentKey: TAGENT,
      name: "treasury-agent",
      environment: "test",
      status: "active",
      declaredCapabilities: [...TREASURY_TOOLS.map((t) => t.name), "task.complete"],
    })
    .returning();
  treasuryAgentId = tagent.id;

  const [task] = await db()
    .insert(tasks)
    .values({
      tenantId,
      agentId: treasuryAgentId,
      title: "Rebalance the $3M treasury: $240k USDC/ETH swap + payroll + staking review (budget $500)",
      budgetUsdCents: 50000,
      status: "open",
    })
    .returning();
  treasuryTaskId = task.id;
}, 60000);

afterAll(async () => {
  // Wipe the throwaway tenant subtree (children first) + its network
  // pseudonym, then restore the env for later files.
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
    // Worktree drift: the uncommitted councils change seeds per-tenant rows
    // with an FK to tenants — delete before the tenant or teardown trips.
    await db().delete(councils).where(eq(councils.tenantId, t.id));
    await db().delete(tasks).where(eq(tasks.tenantId, t.id));
    await db().delete(agents).where(eq(agents.tenantId, t.id));
    await db().delete(tools).where(eq(tools.tenantId, t.id));
    await db().delete(policies).where(eq(policies.tenantId, t.id));
    await db().delete(tenants).where(eq(tenants.id, t.id));
  }
  const pseudo = createHash("sha256").update(`${TAGENT}|cubic-network-v1`).digest("hex").slice(0, 16);
  await db().delete(networkEvents).where(eq(networkEvents.agentPseudonym, pseudo));
  delete process.env.DEMO_TENANT_SLUG;
  delete (globalThis as Record<string, unknown>).__cubicConfig;
}, 60000);

describe("plan-11 treasury branch", () => {
  it("$240k swap escalates (risk_requires_approval) → approve → capability → dev execution", async () => {
    const r = await call(treasuryTaskId, "treasury.swap", { asset_pair: "USDC/ETH", amount_usd_cents: 24_000_000 });
    expect(r.ok && r.data.decision).toBe("escalate");
    expect(r.ok && r.data.matched_policy).toBe("default-v1");
    expect(r.ok && r.data.matched_rule_id).toBe("risk-approval");
    expect(r.ok && r.data.reasons[0]?.code).toBe("risk_requires_approval");
    const approvalId = r.ok && r.data.approval_id;
    expect(approvalId).toMatch(UUID_RE);

    const res = await resolve(approvalId as string, "approved");
    const body = (await res.json()) as {
      ok: boolean;
      data: { capability: { action: string; resource: string } | null; execution: { status: string; result_summary: string | null } | null };
    };
    expect(body.ok).toBe(true);
    expect(body.data.capability).toMatchObject({ action: "treasury_swap", resource: "treasury/USDC/ETH" });
    expect(body.data.execution?.status).toBe("succeeded");
    expect(body.data.execution?.result_summary).toContain("(dev mode)");
  }, 30000);

  it("payroll transfer takes the same escalate → approve → execute path", async () => {
    const r = await call(treasuryTaskId, "treasury.transfer", { destination: "payroll/ops-multisig", amount_usd_cents: 8_500_000 });
    expect(r.ok && r.data.decision).toBe("escalate");
    expect(r.ok && r.data.reasons[0]?.code).toBe("risk_requires_approval");
    const res = await resolve((r.ok && r.data.approval_id) as string, "approved");
    const body = (await res.json()) as {
      ok: boolean;
      data: { capability: { action: string } | null; execution: { status: string } | null };
    };
    expect(body.ok).toBe(true);
    expect(body.data.capability?.action).toBe("treasury_transfer");
    expect(body.data.execution?.status).toBe("succeeded");
  }, 30000);

  it("stake pair splits on the $100 threshold: 0.5 ETH allows, 50 ETH escalates", async () => {
    const small = await call(treasuryTaskId, "treasury.stake", { protocol: "lido", amount_usd_cents: 5_000 });
    expect(small.ok && small.data.decision).toBe("allow");
    expect(small.ok && small.data.matched_rule_id).toBe("default-allow");
    expect(small.ok && small.data.approval_id).toBeNull();
    expect(small.ok && small.data.execution?.status).toBe("succeeded");

    const large = await call(treasuryTaskId, "treasury.stake", { protocol: "lido", amount_usd_cents: 500_000 });
    expect(large.ok && large.data.decision).toBe("escalate");
    expect(large.ok && large.data.reasons[0]?.code).toBe("risk_requires_approval");
  }, 30000);

  it("$450k oversized swap: escalate → approver rejects → no capability, no execution", async () => {
    const r = await call(treasuryTaskId, "treasury.swap", { asset_pair: "USDC/ETH", amount_usd_cents: 45_000_000 });
    expect(r.ok && r.data.decision).toBe("escalate");
    const res = await resolve((r.ok && r.data.approval_id) as string, "rejected");
    const body = (await res.json()) as {
      ok: boolean;
      data: { approval_outcome: string; capability: unknown; execution: unknown };
    };
    expect(body.ok).toBe(true);
    expect(body.data.approval_outcome).toBe("rejected");
    expect(body.data.capability).toBeNull();
    expect(body.data.execution).toBeNull();

    // The rejection is on the record: ledger.approval.completed(rejected).
    const rows = await db().select().from(auditEvents).where(eq(auditEvents.taskId, treasuryTaskId)).orderBy(asc(auditEvents.id));
    const rejected = rows.find(
      (e) => e.eventType === "ledger.approval.completed" && (e.payload as { outcome?: string }).outcome === "rejected",
    );
    expect(rejected).toBeDefined();
  }, 30000);
});

describe("plan-11 reasoning_ref", () => {
  it("client passthrough persists and surfaces through the trace API", async () => {
    const runId = randomUUID();
    const ref = { run_id: runId, share_url: "https://smith.langchain.com/public/abc123/r", model: "test-model" };
    const r = await call(treasuryTaskId, "treasury.stake", { protocol: "lido", amount_usd_cents: 5_000, reasoning_ref: ref });
    expect(r.ok && r.data.decision).toBe("allow");

    const traceRes = await traceGET(new Request("http://test/audit/trace"), { params: Promise.resolve({ taskId: treasuryTaskId }) });
    const body = (await traceRes.json()) as {
      ok: boolean;
      data: { chain: Array<{ intent: { id: string; normalized: { reasoning_ref?: unknown } } }> };
    };
    expect(body.ok).toBe(true);
    const entry = body.data.chain.find((c) => c.intent.id === (r.ok && r.data.intent_id));
    // plan-13: client-supplied refs persist WITH the origin label
    expect(entry?.intent.normalized.reasoning_ref).toEqual({ ...ref, origin: "client-supplied" });
  }, 30000);

  it("key absent → null, no link, no throw (rules-only path)", async () => {
    const r = await call(treasuryTaskId, "treasury.stake", { protocol: "lido", amount_usd_cents: 5_000 });
    expect(r.ok && r.data.decision).toBe("allow");
    const [row] = await db().select().from(intents).where(eq(intents.id, (r.ok && r.data.intent_id) as string));
    expect((row.normalized as { reasoning_ref?: unknown }).reasoning_ref).toBeNull();
  }, 30000);

  it("malformed passthrough shapes are dropped, never throw", async () => {
    for (const bad of [
      { run_id: "lol-fake", share_url: "https://evil.example/phish" },
      { run_id: randomUUID(), share_url: "http://insecure.example/x" },
      { run_id: randomUUID(), share_url: "" },
      { run_id: "", share_url: null },
      "just-a-string",
      42,
    ]) {
      const r = await call(treasuryTaskId, "treasury.stake", { protocol: "lido", amount_usd_cents: 5_000, reasoning_ref: bad });
      expect(r.ok).toBe(true);
      const [row] = await db().select().from(intents).where(eq(intents.id, (r.ok && r.data.intent_id) as string));
      expect((row.normalized as { reasoning_ref?: unknown }).reasoning_ref).toBeNull();
    }
  }, 120000);

  it("provider set but no key → base, null, no throw", async () => {
    // True absence: the dev .env.local may carry a real key — remove it (and
    // the tracing flag) for the duration so this tests the no-key path.
    const savedKey = process.env.LANGSMITH_API_KEY;
    const savedTracing = process.env.LANGSMITH_TRACING;
    delete process.env.LANGSMITH_API_KEY;
    delete process.env.LANGSMITH_TRACING;
    delete (globalThis as Record<string, unknown>).__cubicConfig;
    try {
      const r = await withEnv({ LLM_INTENT_PROVIDER: "test-provider" }, () =>
        call(treasuryTaskId, "treasury.stake", { protocol: "lido", amount_usd_cents: 5_000 }),
      );
      expect(r.ok && r.data.decision).toBe("allow");
      const [row] = await db().select().from(intents).where(eq(intents.id, (r.ok && r.data.intent_id) as string));
      expect((row.normalized as { reasoning_ref?: unknown }).reasoning_ref).toBeNull();
    } finally {
      if (savedKey !== undefined) process.env.LANGSMITH_API_KEY = savedKey;
      if (savedTracing !== undefined) process.env.LANGSMITH_TRACING = savedTracing;
      delete (globalThis as Record<string, unknown>).__cubicConfig;
    }
  }, 30000);

  it.skipIf(!process.env.LANGSMITH_API_KEY)("live key + provider → real run_id, read-back verified", async () => {
    const r = await withEnv({ LLM_INTENT_PROVIDER: "test-provider", LANGSMITH_TRACING: "true" }, () =>
      call(treasuryTaskId, "treasury.stake", { protocol: "lido", amount_usd_cents: 5_000 }),
    );
    expect(r.ok && r.data.decision).toBe("allow");
    const [row] = await db().select().from(intents).where(eq(intents.id, (r.ok && r.data.intent_id) as string));
    const ref = (row.normalized as { reasoning_ref?: { run_id?: unknown; share_url?: unknown } }).reasoning_ref;
    expect(ref?.run_id).toMatch(UUID_RE);
  }, 60000);
});

describe("plan-11 extractReasoningRef (pure)", () => {
  it("accepts the exact contract shape, normalizes absent share_url to null", () => {
    const id = randomUUID();
    expect(extractReasoningRef({ reasoning_ref: { run_id: id, share_url: null } })).toEqual({ run_id: id, share_url: null });
    expect(extractReasoningRef({})).toBeNull();
    expect(extractReasoningRef({ reasoning_ref: null })).toBeNull();
    expect(extractReasoningRef({ reasoning_ref: { run_id: id } })).toEqual({ run_id: id, share_url: null });
  });

  it("rejects fabricated ids, non-https URLs, and oversized models", () => {
    const id = randomUUID();
    expect(extractReasoningRef({ reasoning_ref: { run_id: "not-a-uuid", share_url: null } })).toBeNull();
    expect(extractReasoningRef({ reasoning_ref: { run_id: id, share_url: "http://x.example/" } })).toBeNull();
    expect(extractReasoningRef({ reasoning_ref: { run_id: id, share_url: "" } })).toBeNull();
    expect(extractReasoningRef({ reasoning_ref: { run_id: id, share_url: null, model: "x".repeat(121) } })).toBeNull();
    expect(extractReasoningRef({ reasoning_ref: [{ run_id: id }] })).toBeNull();
  });
});
