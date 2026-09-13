import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { db } from "../src/server/db/client";
import {
  agents, auditEvents, capabilities, councils, decisions, executions, intents,
  networkEvents, policies, tasks, tenants, tools,
} from "../src/server/db/schema";
import { runToolCall } from "../src/server/gateway/orchestrator";
import { createMcpServer, MCP_TOOL_NAMES } from "../src/server/mcp/server";
import { registerExecutor, clearRegisteredExecutors, type Executor } from "../src/server/executors/registry";
import { POST as mcpPOST, GET as mcpGET } from "../src/app/api/mcp/route";
import { POST as toolCallPOST } from "../src/app/api/gateway/tool-call/route";
import { pseudonymFor } from "../src/server/events/projection";

// Test discipline: throwaway tenant test-plan-04, never the demo tenant.
vi.hoisted(() => {
  process.env.DEMO_TENANT_SLUG = "test-plan-04";
});

const TENANT = "test-plan-04";
const AGENT_KEY = "agent:test-04";
const ACCEPT = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };

let tenantId: string;
let agentId: string;
let taskId: string;      // dedicated MCP-path task
let httpTaskId: string;  // dedicated HTTP-ingest-path task

const TOOLS = [
  { name: "github.get_pull_request", category: "coding", default_risk_class: "low", executor: "github" },
  { name: "github.read_file", category: "coding", default_risk_class: "low", executor: "github" },
  { name: "github.merge_pull_request", category: "coding", default_risk_class: "high", executor: "github" },
  { name: "scanner.scan", category: "security", default_risk_class: "medium", executor: "scanner" },
  { name: "task.complete", category: "control", default_risk_class: "low", executor: "task" },
];

const RULES = [
  { id: "deny-secret-resources", type: "resource_class", match: ["secret"], decision: "deny", reason: "secret_resource" },
  { id: "deny-cross-task", type: "resource_class", match: ["cross_task"], decision: "deny", reason: "resource_outside_task" },
  { id: "tool-allowlist", type: "tool_allowlist", tools: TOOLS.map((t) => t.name), decision: "deny", reason: "tool_not_allowed" },
  { id: "reputation-floor", type: "min_reputation", min: 0.8, decision: "escalate", reason: "reputation_below_threshold" },
  { id: "risk-approval", type: "risk_class", match: ["high", "critical"], decision: "escalate", reason: "risk_requires_approval" },
  { id: "default-allow", type: "default", decision: "allow", reason: "policy_default_allow" },
];

async function chainShape(taskIdForChain: string) {
  const events = await db()
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.taskId, taskIdForChain))
    .orderBy(asc(auditEvents.id));
  return {
    types: events.map((e) => e.eventType),
    payloadKeys: events.map((e) => Object.keys(e.payload as Record<string, unknown>).sort()),
  };
}

async function wipe() {
  const tagents = await db().select().from(agents).where(eq(agents.tenantId, tenantId));
  const aids = tagents.map((a) => a.id);
  const tintents = aids.length ? await db().select().from(intents).where(inArray(intents.agentId, aids)) : [];
  const iids = tintents.map((i) => i.id);
  const tdecs = iids.length ? await db().select().from(decisions).where(inArray(decisions.intentId, iids)) : [];
  const dids = tdecs.map((d) => d.id);
  const tcaps = dids.length ? await db().select().from(capabilities).where(inArray(capabilities.decisionId, dids)) : [];
  const cids = tcaps.map((c) => c.id);
  if (cids.length) await db().delete(executions).where(inArray(executions.capabilityId, cids));
  if (dids.length) await db().delete(capabilities).where(inArray(capabilities.decisionId, dids));
  if (iids.length) await db().delete(decisions).where(inArray(decisions.intentId, iids));
  if (aids.length) await db().delete(intents).where(inArray(intents.agentId, aids));
  await db().delete(auditEvents).where(eq(auditEvents.tenantId, tenantId));
  await db().delete(tasks).where(eq(tasks.tenantId, tenantId));
  await db().delete(agents).where(eq(agents.tenantId, tenantId));
  await db().delete(tools).where(eq(tools.tenantId, tenantId));
  await db().delete(policies).where(eq(policies.tenantId, tenantId));
  await db().delete(councils).where(eq(councils.tenantId, tenantId));
  await db().delete(tenants).where(eq(tenants.id, tenantId));
  await db().delete(networkEvents).where(eq(networkEvents.agentPseudonym, pseudonymFor(AGENT_KEY)));
}

beforeAll(async () => {
  const [tenant] = await db()
    .insert(tenants)
    .values({ slug: TENANT, name: "plan-04 mcp throwaway" })
    .onConflictDoUpdate({ target: tenants.slug, set: { name: "plan-04 mcp throwaway" } })
    .returning();
  tenantId = tenant.id;
  const [agent] = await db()
    .insert(agents)
    .values({
      tenantId, agentKey: AGENT_KEY, name: "test-04-mcp", environment: "demo",
      status: "active", declaredCapabilities: TOOLS.map((t) => t.name),
    })
    .returning();
  agentId = agent.id;
  await db().delete(tools).where(eq(tools.tenantId, tenantId));
  await db().insert(tools).values(TOOLS.map((t) => ({
    tenantId, name: t.name, category: t.category, defaultRiskClass: t.default_risk_class,
    executor: t.executor, executorConfig: {},
  })));
  await db().delete(policies).where(eq(policies.tenantId, tenantId));
  await db().insert(policies).values({
    tenantId, name: "default-v1", version: 1, rules: RULES.map((r) => ({ ...r })),
  });
  const [task] = await db()
    .insert(tasks)
    .values({ tenantId, agentId, title: "plan-04 mcp task", budgetUsdCents: 50, status: "open" })
    .returning();
  taskId = task.id;
  const [httpTask] = await db()
    .insert(tasks)
    .values({ tenantId, agentId, title: "plan-04 mcp http-ingest task", budgetUsdCents: 50, status: "open" })
    .returning();
  httpTaskId = httpTask.id;

  // The MCP tests prove transport-independent chain shape; the real HTTP hop
  // to the scanner service is covered in execution.test.ts.
  registerExecutor("scanner", {
    execute: async (input) => ({
      summary: `Security scan of ${String(input.args.target)}: clean (dev mode)`,
      result: { report_id: "rpt_0ab9f100", target: input.args.target, verdict: "clean", findings: [], mode: "dev" },
      mode: "dev",
    }),
  } satisfies Executor);
}, 30000);

afterAll(async () => {
  clearRegisteredExecutors();
  await wipe();
  delete process.env.DEMO_TENANT_SLUG;
}, 30000);

describe("plan-04 MCP facade (in-process)", () => {
  it("lists exactly the 5 gateway tools", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.1" });
    const server = createMcpServer(AGENT_KEY);
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const { tools: listed } = await client.listTools();
      expect(listed.map((t) => t.name).sort()).toEqual([...MCP_TOOL_NAMES].sort());
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("scanner_scan produces the identical event chain shape as HTTP ingest", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.1" });
    const server = createMcpServer(AGENT_KEY);
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const result = await client.callTool({
        name: "scanner_scan",
        arguments: { target: "acme/backend#421", task_id: taskId },
      });
      expect(result.isError).toBeFalsy();
      const text = (result.content as { type: string; text: string }[])[0].text;
      const data = JSON.parse(text);
      expect(data.decision).toBe("allow");
      expect(data.execution).toMatchObject({
        status: "succeeded",
        result_summary: "Security scan of acme/backend#421: clean (dev mode)",
      });
      const mcpChain = await chainShape(taskId);
      expect(mcpChain.types).toEqual([
        "intent.created", "policy.evaluated", "capability.issued",
        "capability.consumed", "tool.execution.started", "tool.execution.completed",
      ]);

      // Same tool through the HTTP ingest route on a dedicated task — chain
      // shape must be identical (transport independence, no shared state).
      const httpRes = await toolCallPOST(
        new Request("http://localhost/api/gateway/tool-call", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-cubic-agent": AGENT_KEY, "x-cubic-task": httpTaskId },
          body: JSON.stringify({ tool: "scanner.scan", arguments: { target: "acme/backend#421" } }),
        }),
      );
      expect(httpRes.status).toBe(200);
      const httpBody = await httpRes.json();
      expect(httpBody.ok).toBe(true);
      expect(httpBody.data.decision).toBe("allow");
      expect(httpBody.data.execution.status).toBe("succeeded");

      const httpChain = await chainShape(httpTaskId);
      expect(httpChain.types).toEqual(mcpChain.types);
      expect(httpChain.payloadKeys).toEqual(mcpChain.payloadKeys);
    } finally {
      await client.close();
      await server.close();
    }
  }, 30000);
});

describe("plan-04 POST /api/mcp (streamable HTTP, stateless)", () => {
  const rpc = (id: number, method: string, params?: Record<string, unknown>) =>
    JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) });

  it("rejects requests without the x-cubic-agent header", async () => {
    const res = await mcpPOST(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: { ...ACCEPT },
        body: rpc(1, "tools/list"),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("INVALID_REQUEST");
  });

  it("answers initialize, lists the 5 tools statelessly, calls a tool, and rejects GET", async () => {
    const initRes = await mcpPOST(
      new Request("http://localhost/api/mcp", {
        method: "POST", headers: { ...ACCEPT, "x-cubic-agent": AGENT_KEY },
        body: rpc(1, "initialize", {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test-client", version: "0.0.1" },
        }),
      }),
    );
    expect(initRes.status).toBe(200);
    const initBody = await initRes.json();
    expect(initBody.result.serverInfo).toEqual({ name: "cubic", version: "0.1.0" });

    const listRes = await mcpPOST(
      new Request("http://localhost/api/mcp", {
        method: "POST", headers: { ...ACCEPT, "x-cubic-agent": AGENT_KEY },
        body: rpc(2, "tools/list"),
      }),
    );
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.result.tools.map((t: { name: string }) => t.name).sort()).toEqual([...MCP_TOOL_NAMES].sort());

    const callRes = await mcpPOST(
      new Request("http://localhost/api/mcp", {
        method: "POST", headers: { ...ACCEPT, "x-cubic-agent": AGENT_KEY },
        body: rpc(3, "tools/call", {
          name: "github_get_pull_request",
          arguments: { repo: "acme/backend", pr: 421 },
        }),
      }),
    );
    expect(callRes.status).toBe(200);
    const callBody = await callRes.json();
    expect(callBody.result.isError).toBeFalsy();
    const data = JSON.parse(callBody.result.content[0].text);
    expect(data.decision).toBe("allow");
    expect(data.execution).toMatchObject({
      status: "succeeded",
      result_summary: "PR #421 'Fix auth flow' — CI passing, approved (mock)",
    });

    const getRes = await mcpGET();
    expect(getRes.status).toBe(405);
  }, 30000);
});
