import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "../src/server/db/client";
import { config } from "../src/server/config";
import {
  agents, approvals, auditEvents, capabilities, decisions, executions,
  intents, payments, policies, tasks, tenants, tools,
} from "../src/server/db/schema";
import { seed } from "../src/server/demo/seed";
import { canonicalPolicyJson, issueCapability } from "../src/server/capability/issue";
import { consumeCapability, revokeCapability, verifyCapability } from "../src/server/capability/verify";
import { runToolCall } from "../src/server/gateway/orchestrator";
import { StaticContextProvider, setContextProvider } from "../src/server/gateway/context/provider";
import type { DecisionResult } from "../src/server/domain";
import { POST as verifyPOST } from "../src/app/api/gateway/verify-capability/route";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX64_RE = /^[0-9a-f]{64}$/;

const SLUG = "test-plan-03";
let tenantId: string;
let agentId: string;
let demoTaskId: string | null = null;
const AGENT_KEY = "agent:test-03";

const POLICY_A = {
  name: "default-v1",
  version: 1,
  rules: [{ id: "default-allow", type: "default", decision: "allow", reason: "policy_default_allow" }],
};
const POLICY_B = {
  name: "default-v1",
  version: 1,
  rules: [
    { id: "reputation-floor", type: "min_reputation", min: 0.8, decision: "escalate", reason: "reputation_below_threshold" },
    { id: "default-allow", type: "default", decision: "allow", reason: "policy_default_allow" },
  ],
};

const ALLOW: DecisionResult = {
  decision: "allow",
  matched_policy: "default-v1",
  matched_rule_id: "default-allow",
  reasons: [{ code: "policy_default_allow" }],
  risk_score: 10,
};
const ESCALATE: DecisionResult = {
  decision: "escalate",
  matched_policy: "production-merge-v1",
  matched_rule_id: "merge-risk",
  reasons: [{ code: "risk_requires_approval" }],
  risk_score: 70,
};
const DENY: DecisionResult = {
  decision: "deny",
  matched_policy: "default-v1",
  matched_rule_id: "deny-secret-resources",
  reasons: [{ code: "secret_resource" }],
  risk_score: 10,
};

async function makeChain(decision: DecisionResult): Promise<{ decisionId: string }> {
  const [agent] = await db().select().from(agents)
    .where(and(eq(agents.tenantId, tenantId), eq(agents.agentKey, AGENT_KEY)));
  const [task] = await db().select().from(tasks)
    .where(and(eq(tasks.tenantId, tenantId), eq(tasks.agentId, agent.id)))
    .orderBy(desc(tasks.createdAt)).limit(1);
  const [intent] = await db().insert(intents).values({
    taskId: task.id,
    agentId: agent.id,
    tool: "github.get_pull_request",
    resource: "acme/backend#421",
    argumentsRedacted: {},
    riskClass: "low",
    origin: "agent",
  }).returning();
  const [row] = await db().insert(decisions).values({
    intentId: intent.id,
    decision: decision.decision,
    matchedPolicy: decision.matched_policy,
    matchedRuleId: decision.matched_rule_id,
    reasons: decision.reasons,
    contextSnapshotHash: "test-hash",
    riskScore: decision.risk_score,
  }).returning();
  return { decisionId: row.id };
}

async function issueAllow(opts?: { amount_usd_cents?: number; policy?: typeof POLICY_A }): Promise<ReturnType<typeof issueCapability>> {
  const { decisionId } = await makeChain(ALLOW);
  return issueCapability({
    decision: ALLOW,
    decisionId,
    intent: {
      tool: "github.get_pull_request",
      action: "get_pull_request",
      resource: "acme/backend#421",
      ...(opts?.amount_usd_cents !== undefined ? { amount_usd_cents: opts.amount_usd_cents } : {}),
      agent_key: AGENT_KEY,
    },
    policy: opts?.policy ?? POLICY_A,
  });
}

async function lastAuditEvent(eventType: string) {
  const rows = await db().select().from(auditEvents)
    .where(and(eq(auditEvents.tenantId, tenantId), eq(auditEvents.eventType, eventType)))
    .orderBy(desc(auditEvents.id)).limit(1);
  return rows[0] ?? null;
}

beforeAll(async () => {
  setContextProvider(new StaticContextProvider());
  await seed(); // demo fixtures for the orchestrator-wiring test (restored in afterAll)
  const [t] = await db().insert(tenants).values({ slug: SLUG, name: "plan-03 throwaway" })
    .onConflictDoUpdate({ target: tenants.slug, set: { name: "plan-03 throwaway" } })
    .returning();
  tenantId = t.id;
  await db().insert(agents).values({
    tenantId, agentKey: AGENT_KEY, name: "test-agent", environment: "test", status: "active",
    declaredCapabilities: ["github.get_pull_request"],
  }).onConflictDoNothing();
  const [a] = await db().select().from(agents)
    .where(and(eq(agents.tenantId, tenantId), eq(agents.agentKey, AGENT_KEY)));
  agentId = a.id;
  await db().insert(tools).values({
    tenantId, name: "github.get_pull_request", category: "coding",
    defaultRiskClass: "low", executor: "github", executorConfig: {},
  }).onConflictDoNothing();
  await db().insert(policies).values({
    tenantId, name: POLICY_A.name, version: POLICY_A.version,
    rules: POLICY_A.rules.map((r) => ({ ...r })),
  }).onConflictDoNothing();
  await db().insert(tasks).values({
    tenantId, agentId, title: "plan-03 capability test task", budgetUsdCents: 50, status: "open",
  });
});

afterAll(async () => {
  // Own demo-task subtree first (children-first by task id) so seed() never
  // sees our orchestrator-wiring rows, even if a prior run left it struggling.
  if (demoTaskId) {
    const ownIntents = await db().select().from(intents).where(eq(intents.taskId, demoTaskId));
    const oIntentIds = ownIntents.map((i) => i.id);
    if (oIntentIds.length) {
      const ownDecisions = await db().select().from(decisions).where(inArray(decisions.intentId, oIntentIds));
      const oDecisionIds = ownDecisions.map((d) => d.id);
      if (oDecisionIds.length) {
        const ownCaps = await db().select().from(capabilities).where(inArray(capabilities.decisionId, oDecisionIds));
        const oCapIds = ownCaps.map((c) => c.id);
        if (oCapIds.length) {
          await db().delete(executions).where(inArray(executions.capabilityId, oCapIds));
          await db().delete(payments).where(inArray(payments.capabilityId, oCapIds));
        }
        await db().delete(approvals).where(inArray(approvals.decisionId, oDecisionIds));
        await db().delete(capabilities).where(inArray(capabilities.decisionId, oDecisionIds));
      }
      await db().delete(decisions).where(inArray(decisions.intentId, oIntentIds));
      await db().delete(intents).where(inArray(intents.id, oIntentIds));
    }
    await db().delete(auditEvents).where(eq(auditEvents.taskId, demoTaskId));
    await db().delete(tasks).where(eq(tasks.id, demoTaskId));
  }
  if (!tenantId) {
    await seed();
    return;
  }
  // Throwaway tenant cascade, children first — never touches other tenants.
  const testAgents = await db().select().from(agents).where(eq(agents.tenantId, tenantId));
  const aIds = testAgents.map((a) => a.id);
  const testIntents = aIds.length
    ? await db().select().from(intents).where(inArray(intents.agentId, aIds)) : [];
  const iIds = testIntents.map((i) => i.id);
  const testDecisions = iIds.length
    ? await db().select().from(decisions).where(inArray(decisions.intentId, iIds)) : [];
  const dIds = testDecisions.map((d) => d.id);
  const testCaps = dIds.length
    ? await db().select().from(capabilities).where(inArray(capabilities.decisionId, dIds)) : [];
  const cIds = testCaps.map((c) => c.id);
  await db().delete(auditEvents).where(eq(auditEvents.tenantId, tenantId));
  if (cIds.length) {
    await db().delete(executions).where(inArray(executions.capabilityId, cIds));
    await db().delete(payments).where(inArray(payments.capabilityId, cIds));
  }
  if (dIds.length) {
    await db().delete(approvals).where(inArray(approvals.decisionId, dIds));
    await db().delete(capabilities).where(inArray(capabilities.decisionId, dIds));
  }
  if (iIds.length) await db().delete(decisions).where(inArray(decisions.intentId, iIds));
  if (aIds.length) await db().delete(intents).where(inArray(intents.agentId, aIds));
  await db().delete(tasks).where(eq(tasks.tenantId, tenantId));
  await db().delete(agents).where(eq(agents.tenantId, tenantId));
  await db().delete(tools).where(eq(tools.tenantId, tenantId));
  await db().delete(policies).where(eq(policies.tenantId, tenantId));
  await db().delete(tenants).where(eq(tenants.id, tenantId));
  await seed(); // restore demo-tenant fixtures after the orchestrator-wiring test
});

describe("plan-03 capability issuance", () => {
  it("issue from allow → IssuedCapability shape, 5m TTL, policy_hash over the document", async () => {
    const before = Date.now();
    const cap = await issueAllow();
    expect(cap.capability_id).toMatch(UUID_RE);
    expect(cap.subject).toBe(AGENT_KEY);
    expect(cap.action).toBe("get_pull_request");
    expect(cap.resource).toBe("acme/backend#421");
    expect(cap.constraints).toEqual({});
    expect(cap.budget_usd_cents).toBeNull();
    expect(cap.nonce).toMatch(HEX64_RE);
    const skew = Math.abs(new Date(cap.expires_at).getTime() - (before + 5 * 60 * 1000));
    expect(skew).toBeLessThan(60_000);
    expect(cap.policy_hash).toMatch(HEX64_RE);
    expect(cap.policy_hash).toBe(
      createHash("sha256").update(canonicalPolicyJson(POLICY_A)).digest("hex"),
    );
    const issued = await lastAuditEvent("capability.issued");
    expect(issued?.payload).toMatchObject({
      capability_id: cap.capability_id,
      subject: AGENT_KEY,
      action: "get_pull_request",
      resource: "acme/backend#421",
      budget_usd_cents: null,
      expires_at: cap.expires_at,
      nonce: cap.nonce,
      policy_hash: cap.policy_hash,
    });
  }, 30000);

  it("policy_hash changes when a rule changes (hashes the document, not the name)", async () => {
    const capA = await issueAllow({ policy: POLICY_A });
    const capB = await issueAllow({ policy: POLICY_B });
    expect(capA.policy_hash).not.toBe(capB.policy_hash);
    expect(capB.policy_hash).toBe(
      createHash("sha256").update(canonicalPolicyJson(POLICY_B)).digest("hex"),
    );
  }, 30000);

  it("issue from deny throws; from escalate+pending throws; from escalate+approved issues", async () => {
    const { decisionId: denyId } = await makeChain(DENY);
    await expect(issueCapability({
      decision: DENY, decisionId: denyId,
      intent: { tool: "github.read_file", action: "read_file", resource: "acme/backend/.env.production", agent_key: AGENT_KEY },
      policy: POLICY_A,
    })).rejects.toThrow("capability gate: cannot issue from a deny decision");

    const { decisionId: escId } = await makeChain(ESCALATE);
    const issueEsc = () => issueCapability({
      decision: ESCALATE, decisionId: escId,
      intent: { tool: "github.merge_pull_request", action: "merge_pull_request", resource: "acme/backend#421", agent_key: AGENT_KEY },
      policy: POLICY_A,
    });
    await db().insert(approvals).values({ decisionId: escId, type: "ledger", provider: "dev", status: "pending" });
    await expect(issueEsc()).rejects.toThrow("capability gate: escalate decision without an approved approval");
    await db().update(approvals).set({ status: "approved" }).where(eq(approvals.decisionId, escId));
    const cap = await issueEsc();
    expect(cap.capability_id).toMatch(UUID_RE);
    expect(cap.action).toBe("merge_pull_request");
  }, 30000);
});

describe("plan-03 consume / verify / revoke", () => {
  it("consume happy path → consumed; second consume → replay", async () => {
    const cap = await issueAllow();
    const first = await consumeCapability(cap.capability_id, { action: cap.action, resource: cap.resource });
    expect(first).toEqual({ status: "consumed", capability_id: cap.capability_id });
    const consumed = await lastAuditEvent("capability.consumed");
    expect(consumed?.payload).toMatchObject({ capability_id: cap.capability_id, execution_id: null });

    const second = await consumeCapability(cap.capability_id, { action: cap.action, resource: cap.resource });
    expect(second).toEqual({ status: "rejected", reason: "replay" });
    const rejected = await lastAuditEvent("capability.rejected");
    expect(rejected?.payload).toMatchObject({ capability_id: cap.capability_id, reason: "replay" });
  }, 30000);

  it("two parallel consumes → exactly one succeeds", async () => {
    const cap = await issueAllow();
    const [r1, r2] = await Promise.all([
      consumeCapability(cap.capability_id, { action: cap.action, resource: cap.resource }),
      consumeCapability(cap.capability_id, { action: cap.action, resource: cap.resource }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual(["consumed", "rejected"]);
    const loser = r1.status === "rejected" ? r1 : r2;
    expect(loser).toEqual({ status: "rejected", reason: "replay" });
  }, 30000);

  it("expired row → expired (and flipped); random uuid → not_found", async () => {
    const cap = await issueAllow();
    await db().update(capabilities).set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
      .where(eq(capabilities.id, cap.capability_id));
    const res = await consumeCapability(cap.capability_id, { action: cap.action, resource: cap.resource });
    expect(res).toEqual({ status: "rejected", reason: "expired" });
    const [row] = await db().select().from(capabilities).where(eq(capabilities.id, cap.capability_id));
    expect(row.status).toBe("expired");

    const missing = await consumeCapability(randomUUID(), { action: "x", resource: "y" });
    expect(missing).toEqual({ status: "rejected", reason: "not_found" });
  }, 30000);

  it("wrong action/resource → mismatch; budget rules per plan", async () => {
    const cap = await issueAllow({ amount_usd_cents: 10 });
    expect(cap.budget_usd_cents).toBe(10);
    expect(await consumeCapability(cap.capability_id, { action: "nope", resource: cap.resource }))
      .toEqual({ status: "rejected", reason: "action_mismatch" });
    expect(await consumeCapability(cap.capability_id, { action: cap.action, resource: "elsewhere" }))
      .toEqual({ status: "rejected", reason: "resource_mismatch" });
    expect(await consumeCapability(cap.capability_id, { action: cap.action, resource: cap.resource, amount: 25 }))
      .toEqual({ status: "rejected", reason: "budget_exceeded" });

    const unbudgeted = await issueAllow();
    const ok = await consumeCapability(unbudgeted.capability_id, { action: unbudgeted.action, resource: unbudgeted.resource });
    expect(ok.status).toBe("consumed"); // amount undefined vs null budget → rule skipped
  }, 30000);

  it("revoke flips issued→revoked; consume after revoke → replay; double revoke → false", async () => {
    const cap = await issueAllow();
    expect(await revokeCapability(cap.capability_id)).toBe(true);
    const [row] = await db().select().from(capabilities).where(eq(capabilities.id, cap.capability_id));
    expect(row.status).toBe("revoked");
    expect(await consumeCapability(cap.capability_id, { action: cap.action, resource: cap.resource }))
      .toEqual({ status: "rejected", reason: "replay" });
    expect(await revokeCapability(cap.capability_id)).toBe(false);
    expect(await revokeCapability(randomUUID())).toBe(false);
  }, 30000);

  it("verifyCapability is non-consuming: verify → issued, then consume still works", async () => {
    const cap = await issueAllow();
    expect(await verifyCapability(cap.capability_id, { action: cap.action, resource: cap.resource }))
      .toEqual({ status: "issued" });
    expect(await verifyCapability(cap.capability_id, { action: "wrong", resource: cap.resource }))
      .toEqual({ status: "rejected", reason: "action_mismatch" });
    const [row] = await db().select().from(capabilities).where(eq(capabilities.id, cap.capability_id));
    expect(row.status).toBe("issued");
    expect(await consumeCapability(cap.capability_id, { action: cap.action, resource: cap.resource }))
      .toEqual({ status: "consumed", capability_id: cap.capability_id });
  }, 30000);
});

describe("plan-03 gateway wiring + route", () => {
  it("POST /api/gateway/verify-capability: issued / rejected / invalid", async () => {
    const cap = await issueAllow();
    const post = (body: unknown) => verifyPOST(
      new Request("http://localhost/api/gateway/verify-capability", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      }),
    );
    const okRes = await post({ capability_id: cap.capability_id, action: cap.action, resource: cap.resource });
    expect(okRes.status).toBe(200);
    expect(await okRes.json()).toEqual({ ok: true, data: { status: "issued" } });

    const badRes = await post({ capability_id: cap.capability_id, action: "wrong", resource: cap.resource });
    expect(await badRes.json()).toEqual({ ok: true, data: { status: "rejected", reason: "action_mismatch" } });

    const missingRes = await post({ capability_id: randomUUID(), action: cap.action, resource: cap.resource });
    expect(await missingRes.json()).toEqual({ ok: true, data: { status: "rejected", reason: "not_found" } });

    const invalidRes = await post({ capability_id: "not-a-uuid" });
    expect(invalidRes.status).toBe(400);
    const invalidBody = await invalidRes.json();
    expect(invalidBody.ok).toBe(false);
    expect(invalidBody.error.code).toBe("INVALID_REQUEST");
  }, 30000);

  async function demoTask() {
    if (!demoTaskId) {
      const [tenant] = await db().select().from(tenants).where(eq(tenants.slug, config().DEMO_TENANT_SLUG));
      const [agent] = await db().select().from(agents)
        .where(and(eq(agents.tenantId, tenant.id), eq(agents.agentKey, "agent:8472")));
      const [task] = await db().insert(tasks).values({
        tenantId: tenant.id, agentId: agent.id,
        title: "plan-03 capability test task (demo tenant)", budgetUsdCents: 50, status: "open",
      }).returning();
      demoTaskId = task.id;
    }
    return { id: demoTaskId };
  }

  it("orchestrator allow → data.capability set with no secrets", async () => {
    const task = await demoTask();
    const allow = await runToolCall({
      task_id: task.id, agent_key: "agent:8472",
      tool: "github.get_pull_request", arguments: { repo: "acme/backend", pr: 421 },
    });
    expect(allow.ok).toBe(true);
    if (!allow.ok) return;
    expect(allow.data.decision).toBe("allow");
    const cap = allow.data.capability;
    expect(cap).not.toBeNull();
    expect(cap!.capability_id).toMatch(UUID_RE);
    expect(cap!.nonce).toMatch(HEX64_RE);
    expect(cap!.subject).toBe("agent:8472");
    // No credentials ever serialize: exact IssuedCapability keys, no secret-ish keys/values.
    expect(Object.keys(cap!).sort()).toEqual([
      "action", "budget_usd_cents", "capability_id", "constraints",
      "expires_at", "nonce", "policy_hash", "resource", "subject",
    ]);
    const serialized = JSON.stringify(allow.data);
    expect(serialized).not.toMatch(/secret|token|password|credential|private_key/i);
    if (process.env.DATABASE_URL) expect(serialized).not.toContain(process.env.DATABASE_URL);

    const events = await db().select().from(auditEvents)
      .where(eq(auditEvents.taskId, task.id)).orderBy(asc(auditEvents.id));
    expect(events.some((e) => e.eventType === "capability.issued")).toBe(true);
  }, 30000);

  it("orchestrator deny → capability null", async () => {
    const task = await demoTask();
    const deny = await runToolCall({
      task_id: task.id, agent_key: "agent:8472",
      tool: "github.delete_repo", arguments: { repo: "acme/backend" },
    });
    expect(deny.ok && deny.data.decision).toBe("deny");
    if (deny.ok) expect(deny.data.capability).toBeNull();
  }, 30000);

  it("orchestrator escalate → capability null, approval pending", async () => {
    const task = await demoTask();
    const esc = await runToolCall({
      task_id: task.id, agent_key: "agent:8472",
      tool: "github.merge_pull_request", arguments: { repo: "acme/backend", pr: 421 },
    });
    expect(esc.ok && esc.data.decision).toBe("escalate");
    if (esc.ok) {
      expect(esc.data.capability).toBeNull();
      expect(esc.data.approval_id).toMatch(UUID_RE);
    }
  }, 30000);
});
