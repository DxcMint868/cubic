import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../src/server/db/client";
import {
  agents, approvals, auditEvents, capabilities, decisions, executions, intents,
  networkEvents, policies, tasks, tenants, tools,
} from "../src/server/db/schema";
import { pseudonymFor } from "../src/server/events/projection";
import { runToolCall } from "../src/server/gateway/orchestrator";
import { POST as resolvePOST } from "../src/app/api/approvals/[id]/resolve/route";
import { GET as traceGET } from "../src/app/api/audit/trace/[taskId]/route";
import { LedgerKeyRingProvider, ringProvisioned } from "../src/server/ledger/keyring";

// Test discipline: throwaway tenant test-plan-06; github executor runs mock
// mode (GITHUB_TOKEN deleted); LEDGER_PROVIDER stays at its dev default so
// the dev-path tests see provider:"dev" canaries.
vi.hoisted(() => {
  process.env.DEMO_TENANT_SLUG = "test-plan-06";
  delete process.env.GITHUB_TOKEN;
  delete process.env.LEDGER_PROVIDER;
  process.env.WALLET_PASS = "vitest-dummy-pass";
});

const TENANT = "test-plan-06";
const AGENT_KEY = "agent:test-06";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let tenantId: string;
let agentId: string;

const TOOLS = [
  { name: "github.get_pull_request", category: "coding", default_risk_class: "low", executor: "github", executor_config: {} },
  { name: "github.merge_pull_request", category: "coding", default_risk_class: "high", executor: "github", executor_config: {} },
];

const RULES = [
  { id: "deny-secret-resources", type: "resource_class", match: ["secret"], decision: "deny", reason: "secret_resource" },
  { id: "deny-cross-task", type: "resource_class", match: ["cross_task"], decision: "deny", reason: "resource_outside_task" },
  { id: "tool-allowlist", type: "tool_allowlist", tools: TOOLS.map((t) => t.name), decision: "deny", reason: "tool_not_allowed" },
  { id: "reputation-floor", type: "min_reputation", min: 0.8, decision: "escalate", reason: "reputation_below_threshold" },
  { id: "risk-approval", type: "risk_class", match: ["high", "critical"], decision: "escalate", reason: "risk_requires_approval" },
  { id: "default-allow", type: "default", decision: "allow", reason: "policy_default_allow" },
];

async function newTask(title: string): Promise<string> {
  const [row] = await db()
    .insert(tasks)
    .values({ tenantId, agentId, title, budgetUsdCents: 50, status: "open" })
    .returning();
  return row.id;
}

function call(taskId: string, tool: string, args: Record<string, unknown> = {}) {
  return runToolCall({ task_id: taskId, agent_key: AGENT_KEY, tool, arguments: args });
}

function resolve(approvalId: string, body: unknown) {
  return resolvePOST(
    new Request("http://test/api/approvals/x/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: approvalId }) },
  );
}

async function taskEvents(taskId: string) {
  return db().select().from(auditEvents).where(eq(auditEvents.taskId, taskId)).orderBy(asc(auditEvents.id));
}

async function trace(taskId: string) {
  return traceGET(new Request(`http://test/api/audit/trace/${taskId}`), {
    params: Promise.resolve({ taskId }),
  });
}

beforeAll(async () => {
  const [tenant] = await db()
    .insert(tenants)
    .values({ slug: TENANT, name: "plan-06 throwaway" })
    .onConflictDoUpdate({ target: tenants.slug, set: { name: "plan-06 throwaway" } })
    .returning();
  tenantId = tenant.id;
  const [agent] = await db()
    .insert(agents)
    .values({
      tenantId, agentKey: AGENT_KEY, name: "test-06", environment: "demo",
      status: "active", declaredCapabilities: TOOLS.map((t) => t.name),
    })
    .returning();
  agentId = agent.id;
  await db().delete(tools).where(eq(tools.tenantId, tenantId));
  await db().insert(tools).values(TOOLS.map((t) => ({
    tenantId, name: t.name, category: t.category, defaultRiskClass: t.default_risk_class,
    executor: t.executor, executorConfig: { ...t.executor_config },
  })));
  await db().delete(policies).where(eq(policies.tenantId, tenantId));
  await db().insert(policies).values([
    { tenantId, name: "default-v1", version: 1, rules: RULES.map((r) => ({ ...r })) },
    // selectPolicy routes merge_pull_request to production-merge-v1 (plan-02);
    // without it the escalation test would deny on no_default_rule.
    {
      tenantId, name: "production-merge-v1", version: 1, rules: [
        { id: "merge-only", type: "tool_allowlist", tools: ["github.merge_pull_request"], decision: "deny", reason: "tool_not_allowed" },
        { id: "merge-reputation", type: "min_reputation", min: 0.9, decision: "escalate", reason: "reputation_below_threshold" },
        { id: "merge-risk", type: "risk_class", match: ["high"], decision: "escalate", reason: "risk_requires_approval" },
        { id: "default-deny", type: "default", decision: "deny", reason: "policy_default_deny" },
      ],
    },
  ]);
}, 30000);

afterAll(async () => {
  const tagents = await db().select().from(agents).where(eq(agents.tenantId, tenantId));
  const aids = tagents.map((a) => a.id);
  const tintents = aids.length ? await db().select().from(intents).where(inArray(intents.agentId, aids)) : [];
  const iids = tintents.map((i) => i.id);
  const tdecs = iids.length ? await db().select().from(decisions).where(inArray(decisions.intentId, iids)) : [];
  const dids = tdecs.map((d) => d.id);
  const tcaps = dids.length ? await db().select().from(capabilities).where(inArray(capabilities.decisionId, dids)) : [];
  const cids = tcaps.map((c) => c.id);
  if (cids.length) await db().delete(executions).where(inArray(executions.capabilityId, cids));
  if (cids.length) await db().delete(capabilities).where(inArray(capabilities.id, cids));
  if (dids.length) await db().delete(approvals).where(inArray(approvals.decisionId, dids));
  if (dids.length) await db().delete(decisions).where(inArray(decisions.id, dids));
  if (iids.length) await db().delete(intents).where(inArray(intents.id, iids));
  await db().delete(auditEvents).where(eq(auditEvents.tenantId, tenantId));
  await db().delete(tasks).where(eq(tasks.tenantId, tenantId));
  await db().delete(agents).where(eq(agents.tenantId, tenantId));
  await db().delete(tools).where(eq(tools.tenantId, tenantId));
  await db().delete(policies).where(eq(policies.tenantId, tenantId));
  await db().delete(tenants).where(eq(tenants.id, tenantId));
  await db().delete(networkEvents).where(eq(networkEvents.agentPseudonym, pseudonymFor(AGENT_KEY)));
  delete process.env.DEMO_TENANT_SLUG;
  delete process.env.WALLET_PASS;
}, 30000);

describe("plan-06 approval resolution", () => {
  it("full chain: escalate → resolve approved → capability → execution, all in one trace", async () => {
    const taskId = await newTask("plan-06 full chain");
    const escalated = await call(taskId, "github.merge_pull_request", { repo: "acme/backend", pr: 421 });
    expect(escalated.ok).toBe(true);
    if (!escalated.ok) return;
    expect(escalated.data.decision).toBe("escalate");
    const approvalId = escalated.data.approval_id as string;
    expect(approvalId).toMatch(UUID_RE);

    const res = await resolve(approvalId, { outcome: "approved" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: {
        decision: string;
        approval_id: string;
        capability: { capability_id: string; action: string; subject: string } | null;
        execution: { execution_id: string; status: string } | null;
        payment: null;
        payment_required: null;
      };
    };
    expect(body.ok).toBe(true);
    expect(body.data.decision).toBe("escalate");
    expect(body.data.approval_id).toBe(approvalId);
    expect(body.data.capability).toMatchObject({ action: "merge_pull_request", subject: AGENT_KEY });
    expect(body.data.execution).toMatchObject({ status: "succeeded" });
    expect(body.data.payment).toBeNull();
    expect(body.data.payment_required).toBeNull();

    const [approvalRow] = await db().select().from(approvals).where(eq(approvals.id, approvalId));
    expect(approvalRow).toMatchObject({ status: "approved", provider: "dev" });
    expect(approvalRow?.completedAt).not.toBeNull();

    const [capRow] = await db()
      .select()
      .from(capabilities)
      .where(eq(capabilities.id, body.data.capability!.capability_id));
    expect(capRow?.status).toBe("consumed");

    const events = await taskEvents(taskId);
    const types = events.map((e) => e.eventType);
    expect(types).toEqual([
      "intent.created",
      "policy.evaluated",
      "capability.escalated",
      "ledger.approval.requested",
      "ledger.approval.completed",
      "capability.issued",
      "capability.consumed",
      "tool.execution.started",
      "tool.execution.completed",
    ]);
    const completed = events.find((e) => e.eventType === "ledger.approval.completed");
    expect(completed?.payload).toMatchObject({
      approval_id: approvalId,
      provider: "dev",
      outcome: "approved",
    });

    // The same chain must be visible through the tenant trace route.
    const traceRes = await trace(taskId);
    expect(traceRes.status).toBe(200);
    const traceBody = (await traceRes.json()) as {
      ok: boolean;
      data: { chain: { approvals: unknown[]; executions: unknown[]; capability: unknown }[] };
    };
    expect(traceBody.ok).toBe(true);
    expect(traceBody.data.chain).toHaveLength(1);
    expect(traceBody.data.chain[0].approvals).toHaveLength(1);
    expect(traceBody.data.chain[0].executions).toHaveLength(1);
    expect(traceBody.data.chain[0].capability).not.toBeNull();
  }, 30000);

  it("rejected approval → no capability, no execution; completed event carries outcome rejected", async () => {
    const taskId = await newTask("plan-06 rejected");
    const escalated = await call(taskId, "github.merge_pull_request", { repo: "acme/backend", pr: 422 });
    expect(escalated.ok).toBe(true);
    if (!escalated.ok) return;
    const approvalId = escalated.data.approval_id as string;

    const res = await resolve(approvalId, { outcome: "rejected" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: {
        decision: string;
        approval_id: string;
        approval_outcome: string;
        capability: unknown;
        payment: unknown;
        execution: unknown;
        payment_required: unknown;
      };
    };
    expect(body.ok).toBe(true);
    expect(body.data).toEqual({
      decision: "escalate",
      approval_id: approvalId,
      approval_outcome: "rejected",
      capability: null,
      payment: null,
      execution: null,
      payment_required: null,
    });

    const [approvalRow] = await db().select().from(approvals).where(eq(approvals.id, approvalId));
    const caps = await db().select().from(capabilities).where(eq(capabilities.decisionId, approvalRow!.decisionId));
    expect(caps).toHaveLength(0);

    const events = await taskEvents(taskId);
    const types = events.map((e) => e.eventType);
    expect(types).toContain("ledger.approval.completed");
    expect(types).not.toContain("capability.issued");
    expect(types).not.toContain("tool.execution.started");
    const completed = events.find((e) => e.eventType === "ledger.approval.completed");
    expect(completed?.payload).toMatchObject({ outcome: "rejected", provider: "dev" });
  }, 30000);

  it("route edge cases: bad body 400, unknown id 404, double resolve 409, non-uuid 400", async () => {
    const badBody = await resolve(crypto.randomUUID(), { outcome: "maybe" });
    expect(badBody.status).toBe(400);

    const unknown = await resolve(crypto.randomUUID(), { outcome: "approved" });
    expect(unknown.status).toBe(404);

    const taskId = await newTask("plan-06 double resolve");
    const escalated = await call(taskId, "github.merge_pull_request", { repo: "acme/backend", pr: 423 });
    if (!escalated.ok) throw new Error("expected escalate");
    const approvalId = escalated.data.approval_id as string;
    const first = await resolve(approvalId, { outcome: "approved" });
    expect(first.status).toBe(200);
    const second = await resolve(approvalId, { outcome: "approved" });
    expect(second.status).toBe(409);

    const nonUuid = await resolve("not-a-uuid", { outcome: "approved" });
    expect(nonUuid.status).toBe(400);
  }, 30000);

  it("dev-provider canary: every ledger.* event in the dev path carries provider:'dev'", async () => {
    const taskId = await newTask("plan-06 canary");
    await call(taskId, "github.get_pull_request", { repo: "acme/backend", pr: 1 }); // allow, no ledger events
    const escalated = await call(taskId, "github.merge_pull_request", { repo: "acme/backend", pr: 424 });
    if (!escalated.ok) throw new Error("expected escalate");
    await resolve(escalated.data.approval_id as string, { outcome: "approved" });

    const events = await taskEvents(taskId);
    const ledgerEvents = events.filter((e) => e.eventType.startsWith("ledger."));
    expect(ledgerEvents.length).toBeGreaterThanOrEqual(2);
    for (const e of ledgerEvents) {
      expect((e.payload as { provider: string }).provider).toBe("dev");
    }
  }, 30000);

  it("LEDGER_PROVIDER=ledger routes through the Key Ring provider and throws on wallet-cli failure — no silent dev fallback", async () => {
    const ringReady = await ringProvisioned();
    if (ringReady) return; // provisioned hosts exercise the real path in the ring tests below

    process.env.LEDGER_PROVIDER = "ledger";
    delete (globalThis as { __cubicConfig?: unknown }).__cubicConfig;
    try {
      const taskId = await newTask("plan-06 ledger provider throws");
      const result = await call(taskId, "github.merge_pull_request", { repo: "acme/backend", pr: 425 });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("INTERNAL");
      expect(result.error.message).toMatch(/wallet-cli|Key Ring|WALLET_PASS/i);
      // The failed ledger request must not leave a dev approvals row behind.
      const taskIntents = await db().select().from(intents).where(eq(intents.taskId, taskId));
      const [decisionRow] = await db()
        .select()
        .from(decisions)
        .where(eq(decisions.intentId, taskIntents[0].id));
      const rows = await db().select().from(approvals).where(eq(approvals.decisionId, decisionRow.id));
      expect(rows).toHaveLength(0);
    } finally {
      delete process.env.LEDGER_PROVIDER;
      delete (globalThis as { __cubicConfig?: unknown }).__cubicConfig;
    }
  }, 30000);
});

const ringReady = await ringProvisioned();

describe.skipIf(!ringReady)("plan-06 Key Ring round-trip (provisioned hosts only)", () => {
  it("protect/use round-trips a secret through wallet-cli ring", async () => {
    const provider = new LedgerKeyRingProvider();
    const secret = "cubic-ring-test-secret-0123456789";
    const ref = await provider.protect("cubic-test-key", secret);
    expect(typeof ref).toBe("string");
    expect(ref).not.toContain(secret);
    expect(ref.startsWith("ring:cubic-test-key:")).toBe(true);
    expect(await provider.use(ref)).toBe(secret);
  }, 30000);

  it("request() records ring-backed approval evidence with provider_ref", async () => {
    // approvals.decision_id has an FK to decisions — build a real chain first.
    const taskId = await newTask("plan-06 ring evidence");
    const [intentRow] = await db()
      .insert(intents)
      .values({ taskId, agentId, tool: "github.merge_pull_request", resource: null, argumentsRedacted: {}, riskClass: "high" })
      .returning();
    const [decisionRow] = await db()
      .insert(decisions)
      .values({ intentId: intentRow.id, decision: "escalate", matchedPolicy: "default-v1", matchedRuleId: "risk-approval", reasons: [], contextSnapshotHash: "0".repeat(64), riskScore: 70 })
      .returning();
    const provider = new LedgerKeyRingProvider();
    const { approval_id } = await provider.request({
      decision_id: decisionRow.id,
      action: "merge_pull_request",
      resource: "acme/backend#421",
      risk_class: "high",
      reason_codes: ["risk_requires_approval"],
    });
    const [row] = await db().select().from(approvals).where(eq(approvals.id, approval_id));
    expect(row).toMatchObject({ provider: "ledger", type: "ledger", status: "pending" });
    expect(row?.providerRef).toMatch(/^ring:encrypt:/);
  }, 30000);
});
