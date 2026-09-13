import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "../src/server/db/client";
import { agents, approvals, auditEvents, intents, tasks, tenants } from "../src/server/db/schema";
import { config } from "../src/server/config";
import { seed } from "../src/server/demo/seed";
import { runToolCall } from "../src/server/gateway/orchestrator";
import {
  StaticContextProvider, setContextProvider,
  type ContextProvider, type FactsCtx, type FactsIntentRef,
} from "../src/server/gateway/context/provider";
import { evaluate } from "../src/server/gateway/policy/engine";
import type { Facts, NormalizedIntent } from "../src/server/domain";
import { registerExecutor, clearRegisteredExecutors, type Executor } from "../src/server/executors/registry";
import { GET as traceGET } from "../src/app/api/audit/trace/[taskId]/route";
import { GET as eventsGET } from "../src/app/api/audit/events/route";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let tenantId: string;
let agentId: string;
let agentKey: string;
let seededTaskId: string; // seed fixture task, budget 50
let budget10TaskId: string | null = null;

async function budget10Task(): Promise<string> {
  if (!budget10TaskId) {
    const [row] = await db()
      .insert(tasks)
      .values({
        tenantId, agentId,
        title: "plan-02 gateway test task (budget 10)",
        budgetUsdCents: 10,
        status: "open",
      })
      .returning();
    budget10TaskId = row.id;
  }
  return budget10TaskId;
}

beforeAll(async () => {
  // plan-04: this file verifies decisions, not the scanner's real HTTP hop —
  // stub it deterministically (the real hop lives in execution.test.ts).
  registerExecutor("scanner", {
    execute: async (input) => ({
      summary: `Security scan of ${String(input.args.target)}: clean — no criticals, 2 advisories`,
      result: { report_id: "rpt_stub0000", target: input.args.target, verdict: "clean", findings: [], mode: "dev" },
      mode: "dev",
    }),
  } satisfies Executor);
  await seed();
  const [tenant] = await db()
    .select()
    .from(tenants)
    .where(eq(tenants.slug, config().DEMO_TENANT_SLUG));
  tenantId = tenant.id;
  const [agent] = await db()
    .select()
    .from(agents)
    .where(and(eq(agents.tenantId, tenantId), eq(agents.agentKey, "agent:8472")));
  agentId = agent.id;
  agentKey = agent.agentKey;
  const [task] = await db()
    .select()
    .from(tasks)
    .where(and(eq(tasks.tenantId, tenantId), eq(tasks.agentId, agentId)))
    .orderBy(desc(tasks.createdAt))
    .limit(1);
  seededTaskId = task.id;
});

afterAll(async () => {
  clearRegisteredExecutors();
  await seed(); // demo-tenant rows only: clears gateway artifacts, restores fixtures
});

const realProvider = new StaticContextProvider();

function withReputation(rep: number): ContextProvider {
  return {
    getFacts: async (intent: FactsIntentRef, ctx: FactsCtx) => ({
      ...(await realProvider.getFacts(intent, ctx)),
      agent_reputation: rep,
    }),
  };
}

function call(tool: string, args: Record<string, unknown>, taskId?: string) {
  return runToolCall(
    taskId
      ? { task_id: taskId, agent_key: agentKey, tool, arguments: args }
      : { agent_key: agentKey, tool, arguments: args },
  );
}

interface Case {
  id: number;
  tool: string;
  args: Record<string, unknown>;
  rep: number;
  taskId?: "seeded" | "budget10";
  decision: string;
  policy: string;
  rule: string;
  reason: string;
  score: number;
}

const cases: Case[] = [
  { id: 1, tool: "github.get_pull_request", args: { repo: "acme/backend", pr: 421 }, rep: 0.95, decision: "allow", policy: "default-v1", rule: "default-allow", reason: "policy_default_allow", score: 10 },
  { id: 2, tool: "github.delete_repo", args: { repo: "acme/backend" }, rep: 0.95, decision: "deny", policy: "default-v1", rule: "tool-allowlist", reason: "tool_not_allowed", score: 40 },
  { id: 3, tool: "github.read_file", args: { repo: "acme/backend", path: ".env.production" }, rep: 0.95, decision: "deny", policy: "default-v1", rule: "deny-secret-resources", reason: "secret_resource", score: 10 },
  { id: 4, tool: "github.read_file", args: { repo: "evil/org", path: "src/x.ts" }, rep: 0.95, decision: "deny", policy: "default-v1", rule: "deny-cross-task", reason: "resource_outside_task", score: 10 },
  { id: 5, tool: "github.merge_pull_request", args: { repo: "acme/backend", pr: 421 }, rep: 0.95, decision: "escalate", policy: "production-merge-v1", rule: "merge-risk", reason: "risk_requires_approval", score: 70 },
  { id: 6, tool: "github.get_pull_request", args: { repo: "acme/backend", pr: 421 }, rep: 0.5, decision: "escalate", policy: "default-v1", rule: "reputation-floor", reason: "reputation_below_threshold", score: 10 },
  { id: 8, tool: "scanner.scan", args: { target: "acme/backend#421", purchase: true, price_usd_cents: 25 }, rep: 0.95, taskId: "seeded", decision: "allow", policy: "payment-v1", rule: "default-allow", reason: "policy_default_allow", score: 40 },
  { id: 9, tool: "scanner.scan", args: { target: "acme/backend#421", purchase: true, price_usd_cents: 25 }, rep: 0.95, taskId: "budget10", decision: "deny", policy: "payment-v1", rule: "budget", reason: "budget_exceeded", score: 40 },
];

describe("plan-02 gateway", () => {
  it.each(cases)("case #$id: $tool → $decision / $rule", async (c) => {
    setContextProvider(withReputation(c.rep));
    const taskId = c.taskId === "budget10" ? await budget10Task() : c.taskId === "seeded" ? seededTaskId : undefined;
    const result = await call(c.tool, c.args, taskId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const d = result.data;
    expect(d.decision).toBe(c.decision);
    expect(d.matched_policy).toBe(c.policy);
    expect(d.matched_rule_id).toBe(c.rule);
    expect(d.reasons[0]?.code).toBe(c.reason);
    expect(d.risk_score).toBe(c.score);
    expect(d.intent_id).toMatch(UUID_RE);
    if (c.decision === "escalate") {
      expect(d.approval_id).toMatch(UUID_RE);
    } else {
      expect(d.approval_id).toBeNull();
    }
    // plan-03: allow issues a scoped capability; deny/escalate issue none.
    if (c.decision === "allow") {
      expect(d.capability).not.toBeNull();
      expect(d.capability!.capability_id).toMatch(UUID_RE);
      expect(d.capability!.nonce).toMatch(/^[0-9a-f]{64}$/);
    } else {
      expect(d.capability).toBeNull();
    }
    // plan-04: allow executes behind the capability; deny/escalate never execute.
    if (c.decision === "allow") {
      expect(d.execution).not.toBeNull();
      expect(d.execution!.status).toBe("succeeded");
      expect(d.execution!.execution_id).toMatch(UUID_RE);
      expect(typeof d.execution!.result_summary).toBe("string");
    } else {
      expect(d.execution).toBeNull();
    }
    expect(d.payment).toBeNull();
    expect(d.payment_required).toBeNull();
  }, 30000);

  it("case #7: evaluate with rules: [] → deny / no_default_rule / no_default_rule", () => {
    const intent: NormalizedIntent = {
      tool: "github.get_pull_request",
      action: "get_pull_request",
      resource: "acme/backend#421",
      risk_class: "low",
      resource_class: "normal",
    };
    const facts: Facts = {
      agent_status: "active",
      agent_reputation: 0.95,
      tool_default_risk: "low",
      task_budget_usd_cents: 50,
      budget_spent_usd_cents: 0,
    };
    const result = evaluate(intent, facts, []);
    expect(result).toEqual({
      decision: "deny",
      matched_policy: "",
      matched_rule_id: "no_default_rule",
      reasons: [{ code: "no_default_rule" }],
      risk_score: 10,
    });
  }, 30000);

  it("purity: case 1 twice → byte-identical DecisionResult JSON; zero fetch calls with LLM_INTENT_PROVIDER unset", async () => {
    setContextProvider(withReputation(0.95));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    try {
      const snapshot = (d: {
        decision: string; matched_policy: string; matched_rule_id: string;
        reasons: { code: string }[]; risk_score: number;
      }) =>
        JSON.stringify({
          decision: d.decision,
          matched_policy: d.matched_policy,
          matched_rule_id: d.matched_rule_id,
          reasons: d.reasons,
          risk_score: d.risk_score,
        });
      const r1 = await call("github.get_pull_request", { repo: "acme/backend", pr: 421 }, seededTaskId);
      const r2 = await call("github.get_pull_request", { repo: "acme/backend", pr: 421 }, seededTaskId);
      expect(r1.ok && r2.ok).toBe(true);
      if (r1.ok && r2.ok) {
        expect(snapshot(r1.data)).toBe(snapshot(r2.data));
      }
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  }, 30000); // remote-DB latency: two full pipelines ≈ 12+ sequential round-trips

  it("escalate path: pending dev approvals row + capability.escalated + ledger.approval.requested", async () => {
    setContextProvider(withReputation(0.95));
    const result = await call("github.merge_pull_request", { repo: "acme/backend", pr: 421 }, seededTaskId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const approvalId = result.data.approval_id;
    expect(approvalId).toMatch(UUID_RE);
    const [approvalRow] = await db().select().from(approvals).where(eq(approvals.id, approvalId as string));
    expect(approvalRow).toMatchObject({
      type: "ledger",
      provider: "dev",
      status: "pending",
      decisionId: expect.any(String),
    });
    const events = await db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.taskId, seededTaskId))
      .orderBy(asc(auditEvents.id));
    const escalated = [...events].reverse().find((e) => e.eventType === "capability.escalated");
    const requested = [...events].reverse().find((e) => e.eventType === "ledger.approval.requested");
    expect(escalated?.payload).toMatchObject({ approval_id: approvalId, reason_codes: ["risk_requires_approval"] });
    expect(requested?.payload).toMatchObject({
      approval_id: approvalId,
      decision_id: expect.any(String),
      provider: config().LEDGER_PROVIDER,
      action: "merge_pull_request",
      resource: "acme/backend#421",
    });
  }, 30000);

  it("GET /api/audit/trace/[taskId] returns the plan-00 §G shape; every decision includes matched_rule_id", async () => {
    setContextProvider(withReputation(0.95));
    const own = await call("github.get_pull_request", { repo: "acme/backend", pr: 421 }, seededTaskId);
    expect(own.ok).toBe(true);
    if (!own.ok) return;
    const ownIntentId = own.data.intent_id;

    const res = await traceGET(
      new Request(`http://localhost/api/audit/trace/${seededTaskId}`),
      { params: Promise.resolve({ taskId: seededTaskId }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.task).toEqual({
      id: seededTaskId,
      title: expect.any(String),
      budget_usd_cents: 50,
      status: "open",
    });
    expect(body.data.chain.length).toBeGreaterThan(0);
    for (const entry of body.data.chain) {
      expect(Object.keys(entry).sort()).toEqual([
        "approvals", "capability", "decision", "executions", "intent", "payments",
      ]);
      expect(entry.intent).toMatchObject({ id: expect.any(String), tool: expect.any(String) });
      if (entry.decision !== null) {
        expect(typeof entry.decision.matched_rule_id).toBe("string");
        expect(entry.decision.matched_rule_id.length).toBeGreaterThan(0);
      }
      expect(entry.payments).toEqual([]);
      // plan-04: allowed intents execute — allowed entries carry their
      // execution; denied/escalated entries carry none.
      if (entry.capability !== null) {
        expect(entry.executions.length).toBeGreaterThanOrEqual(1);
        expect(entry.executions[0].status).toBe("succeeded");
      } else {
        expect(entry.executions).toEqual([]);
      }
      expect(Array.isArray(entry.approvals)).toBe(true);
    }
    const allowEntry = body.data.chain.find((e: { intent: { id: string } }) => e.intent?.id === ownIntentId);
    expect(allowEntry).toBeDefined();
    expect(allowEntry.decision.decision).toBe("allow");
    expect(allowEntry.decision.matched_rule_id).toBe("default-allow");
    // plan-03: the allow entry now carries its issued capability in the trace.
    // plan-04: execution consumes it — status is "consumed" after the run.
    expect(allowEntry.capability).toMatchObject({
      subject: "agent:8472",
      action: "get_pull_request",
      resource: "acme/backend#421",
      status: "consumed",
    });

    expect(body.data.events.length).toBeGreaterThan(0);
    for (const event of body.data.events) {
      // plan-16: trace events now carry the derived HCS anchor
      // {fingerprint, topic_id} (computed, never stored).
      expect(Object.keys(event).sort()).toEqual(["anchor", "event_type", "occurred_at", "payload"]);
      expect(typeof event.occurred_at).toBe("string");
    }
    expect(body.data.events[0].event_type).toBe("intent.created");
  }, 30000);

  it("redaction walks plain objects at ANY depth (plan-13: no cutoff) and sees through arrays", async () => {
    setContextProvider(withReputation(0.95));
    const result = await call(
      "github.get_pull_request",
      {
        repo: "acme/backend", pr: 421,
        api_token: "t0", a: { b: { c: { api_token: "t1" } } }, list: [{ github_token: "t2" }],
        deep: { nested: { deeper: { deepest: { password: "t3" } } } },
      },
      seededTaskId,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [row] = await db().select().from(intents).where(eq(intents.id, result.data.intent_id));
    const redacted = row.argumentsRedacted as Record<string, unknown>;
    expect(redacted.api_token).toBe("[REDACTED]");
    expect((redacted.a as { b: { c: { api_token: string } } }).b.c.api_token).toBe("[REDACTED]");
    expect((redacted.list as { github_token: string }[])[0].github_token).toBe("[REDACTED]");
    expect(redacted.repo).toBe("acme/backend");
    const deepest = (redacted.deep as { nested: { deeper: { deepest: { password: string } } } })
      .nested.deeper.deepest;
    // plan-13: the depth>3 cutoff is gone — nested secrets can never persist
    expect(deepest.password).toBe("[REDACTED]");
  }, 30000);

  it("GET /api/audit/events filters by task_id, event_type and limit", async () => {
    setContextProvider(withReputation(0.95));
    await call("github.read_file", { repo: "acme/backend", path: ".env.production" }, seededTaskId);

    const all = await eventsGET(new Request("http://localhost/api/audit/events?limit=200"));
    expect(all.status).toBe(200);
    const allBody = await all.json();
    expect(allBody.ok).toBe(true);
    expect(allBody.data.events.length).toBeGreaterThan(0);
    const ids = allBody.data.events.map((e: { id: number }) => e.id);
    expect([...ids].sort((a: number, b: number) => b - a)).toEqual(ids); // paged on id desc

    const filtered = await eventsGET(
      new Request(`http://localhost/api/audit/events?task_id=${seededTaskId}&event_type=capability.denied`),
    );
    const filteredBody = await filtered.json();
    expect(filteredBody.ok).toBe(true);
    for (const event of filteredBody.data.events) {
      expect(event.event_type).toBe("capability.denied");
    }
  }, 30000);
});
