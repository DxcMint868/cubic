import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../src/server/db/client";
import {
  agents, auditEvents, capabilities, decisions, executions, intents,
  networkEvents, policies, tasks, tenants, tools,
} from "../src/server/db/schema";
import { pseudonymFor } from "../src/server/events/projection";
import { runToolCall } from "../src/server/gateway/orchestrator";
import { config } from "../src/server/config";
import {
  clearRegisteredExecutors, getExecutor, registerExecutor, type Executor,
} from "../src/server/executors/registry";
import { GithubExecutor } from "../src/server/executors/github";
import { ScannerExecutor } from "../src/server/executors/securityScan";
import { POST as scannerPOST } from "../src/app/api/services/scanner/scan/route";
import { GET as traceGET } from "../src/app/api/audit/trace/[taskId]/route";

// Test discipline: throwaway tenant test-plan-04, own config-driven price, and
// GITHUB_TOKEN deleted so the github executor runs mock mode. vi.hoisted runs
// before imports; config() is lazy, so this fully re-scopes ingest for this file.
vi.hoisted(() => {
  process.env.DEMO_TENANT_SLUG = "test-plan-04";
  process.env.X402_SCANNER_PRICE_CENTS = "37";
  delete process.env.GITHUB_TOKEN;
});

const TENANT = "test-plan-04";
const AGENT_KEY = "agent:test-04";
const REPORT_ID_RE = /^rpt_[0-9a-f]{8}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let tenantId: string;
let agentId: string;
let scannerUrl: string;

const scannerServer = http.createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const webReq = new Request(`http://127.0.0.1${req.url ?? "/"}`, {
    method: req.method ?? "POST",
    headers: req.headers as Record<string, string>,
    body: chunks.length ? Buffer.concat(chunks) : undefined,
  });
  let webRes: Response;
  try {
    webRes = await scannerPOST(webReq);
  } catch (err) {
    webRes = Response.json({ ok: false, error: { code: "INTERNAL", message: String(err) } }, { status: 500 });
  }
  res.statusCode = webRes.status;
  for (const [key, value] of webRes.headers) res.setHeader(key, value);
  res.end(Buffer.from(await webRes.arrayBuffer()));
});

const TOOLS = [
  { name: "github.get_pull_request", category: "coding", default_risk_class: "low", executor: "github", executor_config: {} },
  { name: "github.read_file", category: "coding", default_risk_class: "low", executor: "github", executor_config: {} },
  { name: "github.merge_pull_request", category: "coding", default_risk_class: "high", executor: "github", executor_config: {} },
  { name: "scanner.scan", category: "security", default_risk_class: "medium", executor: "scanner", executor_config: {} },
  { name: "task.complete", category: "control", default_risk_class: "low", executor: "task", executor_config: {} },
  { name: "stub.402", category: "security", default_risk_class: "medium", executor: "stub402", executor_config: {} },
  { name: "fail.tool", category: "coding", default_risk_class: "low", executor: "failing", executor_config: {} },
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

async function taskEvents(taskId: string) {
  return db().select().from(auditEvents).where(eq(auditEvents.taskId, taskId)).orderBy(asc(auditEvents.id));
}

async function capabilityById(capabilityId: string) {
  const [row] = await db().select().from(capabilities).where(eq(capabilities.id, capabilityId));
  return row ?? null;
}

beforeAll(async () => {
  const [tenant] = await db()
    .insert(tenants)
    .values({ slug: TENANT, name: "plan-04 throwaway" })
    .onConflictDoUpdate({ target: tenants.slug, set: { name: "plan-04 throwaway" } })
    .returning();
  tenantId = tenant.id;
  const [agent] = await db()
    .insert(agents)
    .values({
      tenantId, agentKey: AGENT_KEY, name: "test-04", environment: "demo",
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
  await db().insert(policies).values({
    tenantId, name: "default-v1", version: 1, rules: RULES.map((r) => ({ ...r })),
  });

  registerExecutor("stub402", {
    execute: async () => ({
      status: "payment_required",
      price_usd_cents: 25,
      challenge: { kind: "x402", service: "scanner", ref: "test-challenge" },
    }),
  } satisfies Executor);
  registerExecutor("failing", {
    execute: async () => {
      throw new Error("boom");
    },
  } satisfies Executor);

  await new Promise<void>((resolve, reject) => {
    scannerServer.once("error", reject);
    scannerServer.listen(0, "127.0.0.1", () => resolve());
  });
  scannerUrl = `http://127.0.0.1:${(scannerServer.address() as AddressInfo).port}/api/services/scanner/scan`;
  await db().update(tools).set({ executorConfig: { endpoint: scannerUrl } })
    .where(and(eq(tools.tenantId, tenantId), eq(tools.name, "scanner.scan")));
}, 30000);

afterAll(async () => {
  clearRegisteredExecutors();
  scannerServer.close();
  const tagents = await db().select().from(agents).where(eq(agents.tenantId, tenantId));
  const aids = tagents.map((a) => a.id);
  const tintents = aids.length ? await db().select().from(intents).where(inArray(intents.agentId, aids)) : [];
  const iids = tintents.map((i) => i.id);
  const tdecs = iids.length ? await db().select().from(decisions).where(inArray(decisions.intentId, iids)) : [];
  const dids = tdecs.map((d) => d.id);
  const tcaps = dids.length ? await db().select().from(capabilities).where(inArray(capabilities.decisionId, dids)) : [];
  const cids = tcaps.map((c) => c.id);
  if (cids.length) {
    await db().delete(executions).where(inArray(executions.capabilityId, cids));
  }
  if (dids.length) await db().delete(capabilities).where(inArray(capabilities.decisionId, dids));
  if (iids.length) await db().delete(decisions).where(inArray(decisions.intentId, iids));
  if (aids.length) await db().delete(intents).where(inArray(intents.agentId, aids));
  await db().delete(auditEvents).where(eq(auditEvents.tenantId, tenantId));
  await db().delete(tasks).where(eq(tasks.tenantId, tenantId));
  await db().delete(agents).where(eq(agents.tenantId, tenantId));
  await db().delete(tools).where(eq(tools.tenantId, tenantId));
  await db().delete(policies).where(eq(policies.tenantId, tenantId));
  await db().delete(tenants).where(eq(tenants.id, tenantId));
  await db().delete(networkEvents).where(eq(networkEvents.agentPseudonym, pseudonymFor(AGENT_KEY)));
  delete process.env.DEMO_TENANT_SLUG;
  delete process.env.X402_SCANNER_PRICE_CENTS;
}, 30000);

describe("plan-04 executors", () => {
  it("registry: unknown executor → TOOL_NOT_FOUND; scanner without endpoint surfaces at execute", async () => {
    expect(getExecutor(null)).toEqual({ ok: false, error: { code: "TOOL_NOT_FOUND" } });
    expect(getExecutor({ executor: "weird", executorConfig: {} })).toEqual({
      ok: false, error: { code: "TOOL_NOT_FOUND" },
    });
    const scanner = getExecutor({ executor: "scanner", executorConfig: {} });
    expect(scanner.ok).toBe(true);
    if (!scanner.ok) return;
    await expect(
      scanner.executor.execute({
        capability: { id: "cap-0", action: "scan", resource: "acme/backend#421", budgetUsdCents: null },
        args: { target: "acme/backend#421" },
      }),
    ).rejects.toThrow("scanner executor: tools.executor_config.endpoint is not configured");
  });

  it("github executor: EXACT canned mock responses for all three actions", async () => {
    const github = new GithubExecutor();
    const base = { id: "cap-1", resource: "acme/backend#421", budgetUsdCents: null };

    const pr = await github.execute({
      capability: { ...base, action: "get_pull_request" },
      args: { repo: "acme/backend", pr: 421 },
    });
    expect("summary" in pr && pr.summary).toBe("PR #421 'Fix auth flow' — CI passing, approved (mock)");
    expect(pr).toEqual({
      summary: "PR #421 'Fix auth flow' — CI passing, approved (mock)",
      result: { repo: "acme/backend", pr: 421, title: "Fix auth flow", ci: "passing", approved: true },
      mode: "mock",
    });

    const file = await github.execute({
      capability: { id: "cap-2", action: "read_file", resource: "acme/backend/README.md", budgetUsdCents: null },
      args: { repo: "acme/backend", path: "README.md" },
    });
    expect(file).toEqual({
      summary: "Read README.md (mock)",
      result: { path: "README.md", content: "mock file content" },
      mode: "mock",
    });

    const merged = await github.execute({
      capability: { ...base, action: "merge_pull_request" },
      args: { repo: "acme/backend", pr: 421 },
    });
    expect(merged).toEqual({ summary: "Merged PR #421 (mock)", result: { merged: true }, mode: "mock" });
  });

  it("scanner service route: EXACT response shape, config-driven price, report_id regex", async () => {
    const res = await scannerPOST(
      new Request("http://localhost/api/services/scanner/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: "acme/backend#421" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Object.keys(body.data).sort()).toEqual([
      "findings", "mode", "price_usd_cents", "report_id", "target", "verdict",
    ]);
    expect(body.data.report_id).toMatch(REPORT_ID_RE);
    expect(body.data.target).toBe("acme/backend#421");
    expect(body.data.verdict).toBe("clean");
    expect(body.data.findings).toEqual([]);
    expect(body.data.mode).toBe("dev");
    expect(body.data.price_usd_cents).toBe(config().X402_SCANNER_PRICE_CENTS);
    expect(body.data.price_usd_cents).not.toBe(25); // config-driven, never hardcoded

    const bad = await scannerPOST(
      new Request("http://localhost/api/services/scanner/scan", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "not json",
      }),
    );
    expect(bad.status).toBe(400);
    const badBody = await bad.json();
    expect(badBody.ok).toBe(false);
    expect(badBody.error.code).toBe("INVALID_REQUEST");

    const missing = await scannerPOST(
      new Request("http://localhost/api/services/scanner/scan", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
      }),
    );
    expect(missing.status).toBe(400);
  });

  it("scanner executor: deterministic report over a real HTTP hop, report_id matches ^rpt_[0-9a-f]{8}$", async () => {
    const executor = new ScannerExecutor(scannerUrl);
    const outcome = await executor.execute({
      capability: { id: "cap-3", action: "scan", resource: "acme/backend#421", budgetUsdCents: null },
      args: { target: "acme/backend#421" },
    });
    expect("status" in outcome).toBe(false);
    expect(outcome).toMatchObject({
      summary: "Security scan of acme/backend#421: clean (dev mode)",
      mode: "dev",
    });
    const result = (outcome as { result: Record<string, unknown> }).result;
    expect(result.report_id).toMatch(REPORT_ID_RE);
  });

  it("scanner without endpoint → failed execution (tool.execution.failed), capability consumed", async () => {
    const taskId = await newTask("scanner-no-endpoint");
    try {
      await db().update(tools).set({ executorConfig: {} })
        .where(and(eq(tools.tenantId, tenantId), eq(tools.name, "scanner.scan")));
      const result = await call(taskId, "scanner.scan", { target: "acme/backend#421" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.decision).toBe("allow");
      expect(result.data.execution).not.toBeNull();
      expect(result.data.execution!.status).toBe("failed");
      const capId = result.data.capability!.capability_id;
      const [execRow] = await db().select().from(executions).where(eq(executions.capabilityId, capId));
      expect(execRow.status).toBe("failed");
      expect(execRow.executor).toBe("scanner");
      const cap = await capabilityById(capId);
      expect(cap!.status).toBe("consumed"); // failed execution still consumes
      const events = await taskEvents(taskId);
      expect(events.some((e) => e.eventType === "tool.execution.failed")).toBe(true);
    } finally {
      // restore the endpoint for later tests in this file
      await db().update(tools).set({ executorConfig: { endpoint: scannerUrl } })
        .where(and(eq(tools.tenantId, tenantId), eq(tools.name, "scanner.scan")));
    }
  }, 30000);
});

describe("plan-04 orchestrator execution phase", () => {
  it("allowed github.get_pull_request → full chain in /api/audit/trace/[taskId] with started+completed and mode mock visible", async () => {
    const taskId = await newTask("chain trace task");
    const result = await call(taskId, "github.get_pull_request", { repo: "acme/backend", pr: 421 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.execution).toMatchObject({
      status: "succeeded",
      result_summary: "PR #421 'Fix auth flow' — CI passing, approved (mock)",
    });

    const res = await traceGET(
      new Request(`http://localhost/api/audit/trace/${taskId}`),
      { params: Promise.resolve({ taskId }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const entry = body.data.chain.find((e: { intent: { id: string } }) => e.intent?.id === result.data.intent_id);
    expect(entry).toBeDefined();
    expect(entry.decision.decision).toBe("allow");
    expect(entry.capability).toMatchObject({ action: "get_pull_request", status: "consumed" });
    expect(entry.executions).toHaveLength(1);
    expect(entry.executions[0]).toMatchObject({
      tool: "github.get_pull_request", status: "succeeded", executor: "github",
      result_summary: "PR #421 'Fix auth flow' — CI passing, approved (mock)",
    });

    const eventTypes = body.data.events.map((e: { event_type: string }) => e.event_type);
    const own = body.data.events.filter(
      (e: { payload: Record<string, unknown> }) =>
        e.payload.capability_id === entry.capability.id || e.payload.intent_id === result.data.intent_id,
    );
    expect(own.map((e: { event_type: string }) => e.event_type)).toEqual([
      "intent.created", "policy.evaluated", "capability.issued",
      "capability.consumed", "tool.execution.started", "tool.execution.completed",
    ]);
    const started = body.data.events.find(
      (e: { event_type: string; payload: Record<string, unknown> }) =>
        e.event_type === "tool.execution.started" && e.payload.capability_id === entry.capability.id,
    );
    const completed = body.data.events.find(
      (e: { event_type: string; payload: Record<string, unknown> }) =>
        e.event_type === "tool.execution.completed" && e.payload.capability_id === entry.capability.id,
    );
    expect(started).toBeDefined();
    expect(completed).toBeDefined();
    expect(completed.payload.result_summary).toContain("(mock)"); // mode:"mock" visible
    expect(eventTypes[0]).toBe("intent.created");
  }, 30000);

  it("scanner.scan consumes the capability exactly once over the real HTTP hop", async () => {
    const taskId = await newTask("scanner consume task");
    const result = await call(taskId, "scanner.scan", { target: "acme/backend#421" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.execution!.status).toBe("succeeded");
    const capId = result.data.capability!.capability_id;
    const events = await taskEvents(taskId);
    const consumedEvents = events.filter(
      (e) => e.eventType === "capability.consumed" && (e.payload as Record<string, unknown>).capability_id === capId,
    );
    expect(consumedEvents).toHaveLength(1);
    const cap = await capabilityById(capId);
    expect(cap!.status).toBe("consumed");
    const [execRow] = await db().select().from(executions).where(eq(executions.capabilityId, capId));
    expect(execRow.status).toBe("succeeded");
    expect(execRow.resultSummary).toBe("Security scan of acme/backend#421: clean (dev mode)");
  }, 30000);

  it("forced-402 stub → data.payment_required set, NO executions row, NO capability.consumed, capability still issued", async () => {
    const taskId = await newTask("402 stub task");
    const result = await call(taskId, "stub.402", { target: "acme/backend#421" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.decision).toBe("allow");
    expect(result.data.payment_required).toEqual({
      price_usd_cents: 25,
      challenge: { kind: "x402", service: "scanner", ref: "test-challenge" },
    });
    expect(result.data.execution).toBeNull();
    const capId = result.data.capability!.capability_id;
    const execRows = await db().select().from(executions).where(eq(executions.capabilityId, capId));
    expect(execRows).toHaveLength(0); // no executions row
    const events = await taskEvents(taskId);
    const consumed = events.filter(
      (e) => e.eventType === "capability.consumed" && (e.payload as Record<string, unknown>).capability_id === capId,
    );
    expect(consumed).toHaveLength(0); // no capability.consumed event
    const cap = await capabilityById(capId);
    expect(cap!.status).toBe("issued"); // issued-but-unconsumed, expires harmlessly
  }, 30000);

  it("failing executor → tool.execution.failed, executions.status failed, capability not reusable", async () => {
    const taskId = await newTask("failing executor task");
    const result = await call(taskId, "fail.tool", {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.execution).toEqual({
      execution_id: expect.any(String),
      status: "failed",
      result_summary: null,
    });
    const capId = result.data.capability!.capability_id;
    const [execRow] = await db().select().from(executions).where(eq(executions.capabilityId, capId));
    expect(execRow).toMatchObject({
      status: "failed", tool: "fail.tool", executor: "failing", error: "boom",
    });
    const cap = await capabilityById(capId);
    expect(cap!.status).toBe("consumed"); // not reusable
  }, 30000);

  it("task.complete → task row completed, task.completed event, summary 'Task completed'", async () => {
    const taskId = await newTask("task-complete test task");
    const result = await call(taskId, "task.complete", {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.execution).toMatchObject({ status: "succeeded", result_summary: "Task completed" });
    const [taskRow] = await db().select().from(tasks).where(eq(tasks.id, taskId));
    expect(taskRow.status).toBe("completed");
    const events = await taskEvents(taskId);
    // exact chain for a fresh task-only run; task.completed lands after the
    // execution completes (orchestrator-ordered lifecycle)
    expect(events.map((e) => e.eventType)).toEqual([
      "intent.created", "policy.evaluated", "capability.issued",
      "capability.consumed", "tool.execution.started", "tool.execution.completed",
      "task.completed",
    ]);
    const completed = [...events].reverse().find((e) => e.eventType === "task.completed");
    expect(completed).toBeDefined();
    expect(completed!.payload).toEqual({
      task_id: taskId, status: "completed", summary: "Task completed",
    });
  }, 30000);
});
