import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { desc, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "../src/server/db/client";
import {
  agents, approvals, auditEvents, capabilities, decisions, executions,
  intents, networkEvents, payments, policies, tasks, tenants, tools,
} from "../src/server/db/schema";
import { emit } from "../src/server/events/bus";
import { pseudonymFor } from "../src/server/events/projection";
import { setupSwarm, swarmTick, type SwarmAgent } from "../src/server/demo/swarm";
import { GET as eventsGET } from "../src/app/api/network/events/route";
import { GET as statsGET } from "../src/app/api/network/stats/route";
import { GET as streamGET } from "../src/app/api/network/stream/route";
import type { EventType } from "../src/server/events/types";

const TENANT = "test-plan-08";
const AGENT_KEY = "agent:test-08";
const SSE_KEY = "agent:test-08-sse";
const CANARY_KEY = "agent:canary";

// Test discipline: never touch the demo tenant on the shared DB (Wave 3 runs
// plan-03 in parallel against the same database). Point the gateway's
// demo-tenant resolution at our throwaway tenant instead — config() is lazy
// and each test file gets a fresh worker, so this assignment (module scope,
// before any config() call) fully re-scopes ingest + setupSwarm for this file.
process.env.DEMO_TENANT_SLUG = TENANT;

const hex64 = () => (randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "")).slice(0, 64);

let tenantId: string;
let agentId: string;
let taskId: string;
let intentId: string;
let decisionId: string;
let capabilityId: string;
let approvalId: string;
let executionId: string;
let paymentId: string;

const TOOLS = [
  { name: "github.get_pull_request", category: "coding", default_risk_class: "low", executor: "github" },
  { name: "github.read_file", category: "coding", default_risk_class: "low", executor: "github" },
  { name: "github.merge_pull_request", category: "coding", default_risk_class: "high", executor: "github" },
  { name: "deploy.production", category: "deploy", default_risk_class: "critical", executor: "github" },
  { name: "scanner.scan", category: "security", default_risk_class: "medium", executor: "scanner" },
  { name: "task.complete", category: "control", default_risk_class: "low", executor: "task" },
];

const DEFAULT_V1_RULES = [
  { id: "deny-secret-resources", type: "resource_class", match: ["secret"], decision: "deny", reason: "secret_resource" },
  { id: "deny-cross-task", type: "resource_class", match: ["cross_task"], decision: "deny", reason: "resource_outside_task" },
  {
    id: "tool-allowlist", type: "tool_allowlist",
    tools: ["github.get_pull_request", "github.read_file", "github.merge_pull_request", "deploy.production", "scanner.scan", "task.complete"],
    decision: "deny", reason: "tool_not_allowed",
  },
  { id: "reputation-floor", type: "min_reputation", min: 0.8, decision: "escalate", reason: "reputation_below_threshold" },
  { id: "risk-approval", type: "risk_class", match: ["high", "critical"], decision: "escalate", reason: "risk_requires_approval" },
  { id: "default-allow", type: "default", decision: "allow", reason: "policy_default_allow" },
];

async function seedTenant(slug: string) {
  const [tenant] = await db()
    .insert(tenants)
    .values({ slug, name: `${slug} throwaway` })
    .onConflictDoUpdate({ target: tenants.slug, set: { name: `${slug} throwaway` } })
    .returning();
  await db().delete(tools).where(eq(tools.tenantId, tenant.id));
  await db().delete(policies).where(eq(policies.tenantId, tenant.id));
  await db()
    .insert(tools)
    .values(TOOLS.map((t) => ({
      tenantId: tenant.id, name: t.name, category: t.category,
      defaultRiskClass: t.default_risk_class, executor: t.executor, executorConfig: {},
    })));
  await db()
    .insert(policies)
    .values({ tenantId: tenant.id, name: "default-v1", version: 1, rules: DEFAULT_V1_RULES.map((r) => ({ ...r })) });
  return tenant;
}

async function maxNetworkId(): Promise<number> {
  const [row] = await db()
    .select({ v: sql<number>`coalesce(max(${networkEvents.id}),0)` })
    .from(networkEvents);
  return Number(row?.v ?? 0);
}

async function wipeTenant(slug: string) {
  const [t] = await db().select().from(tenants).where(eq(tenants.slug, slug));
  if (t) {
    const tagents = await db().select().from(agents).where(eq(agents.tenantId, t.id));
    const aids = tagents.map((a) => a.id);
    const tintents = aids.length
      ? await db().select().from(intents).where(inArray(intents.agentId, aids))
      : [];
    const iids = tintents.map((i) => i.id);
    const tdecs = iids.length
      ? await db().select().from(decisions).where(inArray(decisions.intentId, iids))
      : [];
    const dids = tdecs.map((d) => d.id);
    const tcaps = dids.length
      ? await db().select().from(capabilities).where(inArray(capabilities.decisionId, dids))
      : [];
    const cids = tcaps.map((c) => c.id);
    if (cids.length) {
      await db().delete(executions).where(inArray(executions.capabilityId, cids));
      await db().delete(payments).where(inArray(payments.capabilityId, cids));
    }
    if (dids.length) {
      await db().delete(approvals).where(inArray(approvals.decisionId, dids));
      await db().delete(capabilities).where(inArray(capabilities.decisionId, dids));
    }
    if (iids.length) await db().delete(decisions).where(inArray(decisions.intentId, iids));
    if (aids.length) await db().delete(intents).where(inArray(intents.agentId, aids));
    await db().delete(auditEvents).where(eq(auditEvents.tenantId, t.id));
    await db().delete(tasks).where(eq(tasks.tenantId, t.id));
    await db().delete(agents).where(eq(agents.tenantId, t.id));
    await db().delete(tools).where(eq(tools.tenantId, t.id));
    await db().delete(policies).where(eq(policies.tenantId, t.id));
    await db().delete(tenants).where(eq(tenants.id, t.id));
  }
}

beforeAll(async () => {
  const tenant = await seedTenant(TENANT);
  tenantId = tenant.id;
  const [agent] = await db()
    .insert(agents)
    .values({
      tenantId, agentKey: AGENT_KEY, name: "test-08", environment: "demo",
      status: "active", declaredCapabilities: ["github.read_file"],
    })
    .returning();
  agentId = agent.id;
  const [task] = await db()
    .insert(tasks)
    .values({ tenantId, agentId, title: "plan-08 test task", budgetUsdCents: 50, status: "open" })
    .returning();
  taskId = task.id;
  const [intent] = await db()
    .insert(intents)
    .values({
      taskId, agentId, tool: "github.read_file", resource: "acme/backend/README.md",
      argumentsRedacted: {}, riskClass: "high", origin: "agent",
    })
    .returning();
  intentId = intent.id;
  const [decision] = await db()
    .insert(decisions)
    .values({
      intentId, decision: "allow", matchedPolicy: "default-v1", matchedRuleId: "default-allow",
      reasons: [{ code: "policy_default_allow" }], contextSnapshotHash: "test", riskScore: 70,
    })
    .returning();
  decisionId = decision.id;
  const [capability] = await db()
    .insert(capabilities)
    .values({
      decisionId, subject: AGENT_KEY, action: "read_file", resource: "acme/backend/README.md",
      constraints: {}, budgetUsdCents: null,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      nonce: hex64(), policyHash: hex64(), status: "issued",
    })
    .returning();
  capabilityId = capability.id;
  const [approval] = await db()
    .insert(approvals)
    .values({ decisionId, type: "ledger", provider: "dev", status: "pending" })
    .returning();
  approvalId = approval.id;
  const [execution] = await db()
    .insert(executions)
    .values({ capabilityId, tool: "github.read_file", status: "running", executor: "github" })
    .returning();
  executionId = execution.id;
  const [payment] = await db()
    .insert(payments)
    .values({ capabilityId, service: "scanner", network: "hedera", amountUsdCents: 25, status: "requested" })
    .returning();
  paymentId = payment.id;
}, 30000);

afterAll(async () => {
  await wipeTenant(TENANT);
  const pseudos = new Set<string>([
    pseudonymFor(AGENT_KEY), pseudonymFor(SSE_KEY), pseudonymFor(CANARY_KEY),
  ]);
  for (let i = 1; i <= 8; i += 1) pseudos.add(pseudonymFor(`agent:swarm-${i}`));
  for (const p of pseudos) {
    await db().delete(networkEvents).where(eq(networkEvents.agentPseudonym, p));
  }
}, 30000);

function emitAs(
  eventType: EventType,
  payload: Record<string, unknown>,
  opts: { metaKey?: string; withAgentId?: boolean } = {},
) {
  return emit(
    {
      event_type: eventType,
      tenant_id: tenantId,
      task_id: taskId,
      agent_id: opts.withAgentId === false ? null : agentId,
      payload,
    },
    opts.metaKey ? { agent_key: opts.metaKey } : {},
  );
}

describe("plan-08 projection coverage", () => {
  it("every mapped event type produces exactly one row with the exact action_class/outcome", async () => {
    const expiresAt = new Date(Date.now() + 300_000).toISOString();
    const table: { type: EventType; payload: Record<string, unknown>; action: string; outcome: string }[] = [
      { type: "intent.created", payload: { intent_id: intentId, tool: "github.read_file", resource: null, risk_class: "high", origin: "agent" }, action: "intent", outcome: "created" },
      { type: "policy.evaluated", payload: { intent_id: intentId, decision_id: decisionId, decision: "escalate", matched_policy: "default-v1", matched_rule_id: "risk-approval", reason_codes: ["risk_requires_approval"], risk_score: 70 }, action: "evaluation", outcome: "escalate" },
      { type: "capability.issued", payload: { capability_id: capabilityId, decision_id: decisionId, subject: AGENT_KEY, action: "read_file", resource: "acme/backend/README.md", budget_usd_cents: null, expires_at: expiresAt, nonce: hex64(), policy_hash: hex64() }, action: "authorization", outcome: "issued" },
      { type: "capability.denied", payload: { intent_id: intentId, decision_id: decisionId, reason_codes: ["secret_resource"] }, action: "authorization", outcome: "denied" },
      { type: "capability.escalated", payload: { intent_id: intentId, decision_id: decisionId, approval_id: approvalId, reason_codes: ["risk_requires_approval"] }, action: "authorization", outcome: "escalated" },
      { type: "capability.consumed", payload: { capability_id: capabilityId, execution_id: null }, action: "authorization", outcome: "consumed" },
      { type: "capability.rejected", payload: { capability_id: null, reason: "replay", requested_action: "read_file", requested_resource: "acme/backend/README.md" }, action: "authorization", outcome: "replay" },
      { type: "ledger.approval.requested", payload: { approval_id: approvalId, decision_id: decisionId, provider: "dev", action: "merge_pull_request", resource: "acme/backend#421" }, action: "approval", outcome: "requested" },
      { type: "ledger.approval.completed", payload: { approval_id: approvalId, decision_id: decisionId, provider: "dev", outcome: "approved" }, action: "approval", outcome: "approved" },
      { type: "payment.requested", payload: { payment_id: paymentId, capability_id: capabilityId, service: "scanner", network: "hedera", amount_usd_cents: 25 }, action: "payment", outcome: "requested" },
      { type: "payment.completed", payload: { payment_id: paymentId, capability_id: capabilityId, settlement_ref: "tx-test-1" }, action: "payment", outcome: "completed" },
      { type: "payment.failed", payload: { payment_id: paymentId, capability_id: capabilityId, error_code: "settlement_timeout" }, action: "payment", outcome: "failed" },
      { type: "service.discovered", payload: { intent_id: intentId, service: "scanner", price_usd_cents: 25, challenge_ref: "ch-1" }, action: "discovery", outcome: "discovered" },
      { type: "tool.execution.started", payload: { execution_id: executionId, capability_id: capabilityId, tool: "github.read_file", resource: "acme/backend/README.md" }, action: "execution", outcome: "started" },
      { type: "tool.execution.completed", payload: { execution_id: executionId, capability_id: capabilityId, result_summary: "report" }, action: "execution", outcome: "succeeded" },
      { type: "tool.execution.failed", payload: { execution_id: executionId, capability_id: capabilityId, error_code: "executor_error" }, action: "execution", outcome: "failed" },
      { type: "task.completed", payload: { task_id: taskId, status: "completed", summary: null }, action: "task", outcome: "completed" },
    ];

    const before = await maxNetworkId();
    for (const row of table) {
      await emitAs(row.type, row.payload, { metaKey: AGENT_KEY });
    }
    const rows = await db()
      .select()
      .from(networkEvents)
      .where(gt(networkEvents.id, before))
      .orderBy(desc(networkEvents.id));
    expect(rows).toHaveLength(table.length);
    for (const row of table) {
      const match = rows.filter((r) => r.eventType === row.type);
      expect(match).toHaveLength(1);
      expect(match[0].actionClass).toBe(row.action);
      expect(match[0].outcome).toBe(row.outcome);
    }
  }, 30000);

  it("resolves agent_key, category, and risk through the capability chain with no meta", async () => {
    const before = await maxNetworkId();
    // No meta at all: agent_key falls back to the agents row; category/risk
    // fall back through capability → decision → intent (coding / high).
    await emitAs(
      "capability.consumed",
      { capability_id: capabilityId, execution_id: null },
      { withAgentId: true },
    );
    const rows = await db().select().from(networkEvents).where(gt(networkEvents.id, before));
    expect(rows).toHaveLength(1);
    expect(rows[0].agentPseudonym).toBe(pseudonymFor(AGENT_KEY));
    expect(rows[0].agentCategory).toBe("coding");
    expect(rows[0].riskClass).toBe("high");
  }, 30000);

  it("resolves category/risk through execution and payment chains", async () => {
    const before = await maxNetworkId();
    // Bogus capability_id forces the execution_id / payment_id links to fire.
    await emitAs(
      "tool.execution.completed",
      { execution_id: executionId, capability_id: randomUUID(), result_summary: "r" },
      { metaKey: AGENT_KEY },
    );
    await emitAs(
      "payment.completed",
      { payment_id: paymentId, capability_id: randomUUID(), settlement_ref: "tx" },
      { metaKey: AGENT_KEY },
    );
    const rows = await db().select().from(networkEvents).where(gt(networkEvents.id, before));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.agentCategory).toBe("coding");
      expect(row.riskClass).toBe("high");
    }
  }, 30000);

  it("falls back to control/low and skips projection when the agent is unresolvable", async () => {
    const before = await maxNetworkId();
    await emitAs(
      "task.completed",
      { task_id: taskId, status: "failed", summary: null },
      { metaKey: AGENT_KEY },
    );
    const fallback = await db().select().from(networkEvents).where(gt(networkEvents.id, before));
    expect(fallback).toHaveLength(1);
    expect(fallback[0].agentCategory).toBe("control");
    expect(fallback[0].riskClass).toBe("low");

    // No meta and no envelope agent_id → audit row persists, no network row.
    const auditBefore = await maxNetworkId();
    await emit(
      {
        event_type: "intent.created",
        tenant_id: tenantId,
        task_id: taskId,
        agent_id: null,
        payload: { intent_id: intentId, tool: "github.read_file", resource: null, risk_class: "low", origin: "agent" },
      },
      {},
    );
    expect(await maxNetworkId()).toBe(auditBefore);
  }, 30000);
});

describe("plan-08 privacy canary", () => {
  it("CANARY token and raw agent_key never reach the projection or any public route", async () => {
    await emitAs(
      "intent.created",
      {
        intent_id: randomUUID(), tool: "github.read_file",
        resource: "CANARY-t0k3n-secret-file", risk_class: "low", origin: "agent",
      },
      { metaKey: CANARY_KEY, withAgentId: false },
    );

    const canaryPseudo = pseudonymFor(CANARY_KEY);
    const rows = await db()
      .select()
      .from(networkEvents)
      .where(eq(networkEvents.agentPseudonym, canaryPseudo));
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain("CANARY");
    expect(JSON.stringify(rows)).not.toContain(CANARY_KEY);

    const eventsRes = await eventsGET(new Request("http://localhost/api/network/events?limit=200"));
    expect(eventsRes.status).toBe(200);
    const eventsText = await eventsRes.text();
    expect(eventsText).not.toContain("CANARY");
    expect(eventsText).not.toContain(CANARY_KEY);

    const statsRes = await statsGET();
    expect(statsRes.status).toBe(200);
    const statsText = await statsRes.text();
    expect(statsText).not.toContain("CANARY");
    expect(statsText).not.toContain(CANARY_KEY);

    const streamRes = await streamGET();
    expect(streamRes.headers.get("Content-Type")).toContain("text/event-stream");
    const { raw } = await readSseUntil(streamRes, (f) => f.agent_pseudonym === canaryPseudo, 200);
    expect(raw).toContain(canaryPseudo);
    expect(raw).not.toContain("CANARY");
    expect(raw).not.toContain(CANARY_KEY);
  }, 30000);
});

describe("plan-08 network routes", () => {
  it("GET /api/network/events pages newest-first with the exact row shape", async () => {
    const first = await eventsGET(new Request("http://localhost/api/network/events?limit=2"));
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.ok).toBe(true);
    expect(firstBody.data.events).toHaveLength(2);
    const ids = firstBody.data.events.map((e: { id: number }) => e.id);
    expect(ids[0]).toBeGreaterThan(ids[1]);
    for (const event of firstBody.data.events) {
      expect(Object.keys(event).sort()).toEqual([
        "action_class", "agent_category", "agent_pseudonym", "created_at",
        "event_type", "id", "outcome", "risk_class",
      ]);
    }

    const next = await eventsGET(
      new Request(`http://localhost/api/network/events?limit=50&before_id=${ids[1]}`),
    );
    const nextBody = await next.json();
    expect(nextBody.ok).toBe(true);
    for (const event of nextBody.data.events) {
      expect(event.id).toBeLessThan(ids[1]);
    }

    const badLimit = await eventsGET(new Request("http://localhost/api/network/events?limit=0"));
    expect(badLimit.status).toBe(400);
    const badLimitBody = await badLimit.json();
    expect(badLimitBody).toEqual({
      ok: false, error: { code: "INVALID_REQUEST", message: "limit must be a positive integer" },
    });

    const badBefore = await eventsGET(new Request("http://localhost/api/network/events?before_id=nope"));
    expect(badBefore.status).toBe(400);
  }, 30000);

  it("GET /api/network/stats counts deltas over network_events", async () => {
    const readStats = async () => {
      const res = await statsGET();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(Object.keys(body.data).sort()).toEqual([
        "agents_observed", "allowed", "denied", "escalated",
        "intents_evaluated", "payments_completed",
      ]);
      return body.data as Record<string, number>;
    };
    const before = await readStats();
    await emitAs(
      "policy.evaluated",
      { intent_id: intentId, decision_id: decisionId, decision: "allow", matched_policy: "default-v1", matched_rule_id: "default-allow", reason_codes: ["policy_default_allow"], risk_score: 10 },
      { metaKey: AGENT_KEY },
    );
    await emitAs(
      "policy.evaluated",
      { intent_id: intentId, decision_id: decisionId, decision: "deny", matched_policy: "default-v1", matched_rule_id: "default-deny", reason_codes: ["policy_default_deny"], risk_score: 10 },
      { metaKey: AGENT_KEY },
    );
    await emitAs(
      "payment.completed",
      { payment_id: randomUUID(), capability_id: capabilityId, settlement_ref: "tx-stats" },
      { metaKey: AGENT_KEY },
    );
    const after = await readStats();
    expect(after.intents_evaluated - before.intents_evaluated).toBe(2);
    expect(after.allowed - before.allowed).toBe(1);
    expect(after.denied - before.denied).toBe(1);
    expect(after.escalated - before.escalated).toBe(0);
    expect(after.payments_completed - before.payments_completed).toBe(1);
  }, 30000);

  it("SSE delivers live events in order and skips heartbeat comments", async () => {
    const baseline = await maxNetworkId();
    const streamRes = await streamGET();
    expect(streamRes.headers.get("Content-Type")).toContain("text/event-stream");

    const tools = ["github.get_pull_request", "github.read_file", "scanner.scan"];
    for (const tool of tools) {
      await emitAs(
        "intent.created",
        { intent_id: randomUUID(), tool, resource: null, risk_class: "low", origin: "agent" },
        { metaKey: SSE_KEY },
      );
    }

    const ssePseudo = pseudonymFor(SSE_KEY);
    const { frames, raw } = await readSseUntil(
      streamRes,
      (f, collected) => collected.filter((c) => c.agent_pseudonym === ssePseudo).length >= 3,
      500,
    );
    expect(raw).toContain("event: network");
    const ours = frames.filter((f) => f.agent_pseudonym === ssePseudo && (f.id as number) > baseline);
    for (const f of ours) expect("tool" in f).toBe(false); // allowlist: no tool field leaks
    expect(ours).toHaveLength(3);
    expect(ours.map((f) => f.event_type)).toEqual(["intent.created", "intent.created", "intent.created"]);
    const ids = ours.map((f) => f.id as number);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
  }, 30000);
});

describe("plan-08 swarm", () => {
  it("runs the real pipeline; activity lands in audit + network events from demo agents", async () => {
    // No seed() here: the throwaway tenant already has the tools + policy
    // fixtures from beforeAll, and setupSwarm creates its own agents + tasks.
    // The demo tenant is never touched (see DEMO_TENANT_SLUG above).
    let state: SwarmAgent[] = [];
    try {
      state = await setupSwarm();
      expect(state).toHaveLength(8);
      expect(new Set(state.map((a) => a.key)).size).toBe(8);
      const again = await setupSwarm();
      const agentCount = await db()
        .select()
        .from(agents)
        .where(inArray(agents.id, again.map((a) => a.agentId)));
      expect(agentCount).toHaveLength(8); // idempotent: no duplicates

      const lines = await swarmTick(again);
      expect(lines).toHaveLength(8);
      for (const line of lines) {
        expect(line).toMatch(/^\[swarm\] agent:swarm-\d /);
        expect(line).not.toContain("error");
      }

      const swarmIds = again.map((a) => a.agentId);
      const audits = await db().select().from(auditEvents).where(inArray(auditEvents.agentId, swarmIds));
      expect(audits.length).toBeGreaterThan(0);

      const pseudos = again.map((a) => pseudonymFor(a.key));
      const nets = await db().select().from(networkEvents).where(inArray(networkEvents.agentPseudonym, pseudos));
      expect(nets.length).toBeGreaterThan(0);

      const demoAgents = await db().select().from(agents).where(inArray(agents.id, swarmIds));
      expect(demoAgents).toHaveLength(8);
      for (const a of demoAgents) expect(a.environment).toBe("demo");

      // Every swarm agent attempted its scripted .env read by tick 3.
      await swarmTick(again);
      await swarmTick(again);
      const denied = await db().select().from(auditEvents).where(inArray(auditEvents.agentId, swarmIds));
      const denyCount = denied.filter((e) => e.eventType === "capability.denied").length;
      expect(denyCount).toBeGreaterThanOrEqual(8);
    } finally {
      // Remove only our own swarm chains + swarm network rows. No seed():
      // the throwaway tenant is wiped in afterAll, and seed() would touch
      // the shared demo tenant's fixture-pseudonym network rows.
      const swarmIds = state.map((a) => a.agentId);
      if (swarmIds.length) {
        const sintents = await db().select().from(intents).where(inArray(intents.agentId, swarmIds));
        const siids = sintents.map((i) => i.id);
        const sdecs = siids.length
          ? await db().select().from(decisions).where(inArray(decisions.intentId, siids))
          : [];
        const sdids = sdecs.map((d) => d.id);
        if (sdids.length) {
          await db().delete(approvals).where(inArray(approvals.decisionId, sdids));
          await db().delete(capabilities).where(inArray(capabilities.decisionId, sdids));
        }
        if (siids.length) await db().delete(decisions).where(inArray(decisions.intentId, siids));
        await db().delete(intents).where(inArray(intents.agentId, swarmIds));
        await db().delete(auditEvents).where(inArray(auditEvents.agentId, swarmIds));
        await db().delete(tasks).where(inArray(tasks.agentId, swarmIds));
        await db().delete(agents).where(inArray(agents.id, swarmIds));
      }
      for (const a of state) {
        await db().delete(networkEvents).where(eq(networkEvents.agentPseudonym, pseudonymFor(a.key)));
      }
    }
  }, 180000);
});

// Minimal SSE client: collects data frames until `done` fires or the cap/timeout hits.
async function readSseUntil(
  res: Response,
  done: (frame: Record<string, unknown>, collected: Record<string, unknown>[]) => boolean,
  cap: number,
  timeoutMs = 15000,
): Promise<{ frames: Record<string, unknown>[]; raw: string }> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("sse: response has no body");
  const decoder = new TextDecoder();
  let buf = "";
  let raw = "";
  const frames: Record<string, unknown>[] = [];
  const deadline = Date.now() + timeoutMs;
  try {
    while (frames.length < cap && Date.now() < deadline) {
      const { done: streamDone, value } = await reader.read();
      if (streamDone) break;
      const chunk = decoder.decode(value, { stream: true });
      raw += chunk;
      buf += chunk;
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (block.startsWith(":")) continue; // heartbeat/comment — must not break parsing
        const dataLine = block.split("\n").find((l) => l.startsWith("data: "));
        if (!dataLine) continue;
        const frame = JSON.parse(dataLine.slice("data: ".length)) as Record<string, unknown>;
        frames.push(frame);
        if (done(frame, frames)) return { frames, raw };
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Already closed; route cancel() still runs its cleanup.
    }
  }
  return { frames, raw };
}
