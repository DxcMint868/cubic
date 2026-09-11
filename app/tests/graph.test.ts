import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../src/server/db/client";
import { agents, networkEvents, tasks, tenants } from "../src/server/db/schema";
import { config } from "../src/server/config";
import { seed } from "../src/server/demo/seed";
import { runToolCall } from "../src/server/gateway/orchestrator";
import {
  AutoContextProvider,
  StaticContextProvider,
  setContextProvider,
} from "../src/server/gateway/context/provider";
import {
  GraphContextProvider,
  NEUTRAL_REPUTATION,
} from "../src/server/gateway/context/graphProvider";
import {
  AGENT0_QUERY,
  HttpAgent0Client,
  type Agent0Client,
  type AgentTrust,
} from "../src/server/graph/agent0";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEST_URL = "https://gateway.thegraph.com/api/test-key/subgraphs/id/test-id";
const GRAPH_IDENTITY = "8453:9001";
const GRAPH_IDENTITY_2 = "8453:9002";

const pseudonymFor = (agentKey: string) =>
  createHash("sha256").update(`${agentKey}|cubic-network-v1`).digest("hex").slice(0, 16);

let labTaskId: string;
let graphTaskId: string;
let graphTaskId2: string;
let graphAgentId: string;
let graphAgentId2: string;
let staticAgentId: string; // agent:8472 — no erc8004_identity
let staticTaskId: string;

function stubClient(trust: AgentTrust, calls?: { count: number }): Agent0Client {
  return {
    lookup: async (identity) => {
      if (calls) calls.count += 1;
      if (identity === "") throw new Error("lookup: empty identity");
      return trust;
    },
  };
}

const rejectingClient: Agent0Client = {
  lookup: async () => {
    throw new Error("subgraph unreachable");
  },
};

const highTrust: AgentTrust = {
  identity: GRAPH_IDENTITY,
  reputation: 0.95,
  validation: "passed",
  capabilities: ["github.get_pull_request"],
};

const subgraphPayload = (
  feedback: number[],
  validation: { status: string; response: number | null } | null,
  id = GRAPH_IDENTITY,
) => ({
  data: {
    agent: {
      id,
      registrationFile: {
        mcpEndpoint: "https://mcp.example/rpc",
        mcpTools: ["github.get_pull_request"],
        a2aSkills: ["risk-analysis"],
      },
      feedback: feedback.map((value) => ({ value: String(value) })), // BigDecimal serializes as string
      validations: validation ? [validation] : [],
    },
  },
});

// config() caches on globalThis.__cubicConfig; swap it for router-selection
// tests and always restore (other suites in this worker rely on real env).
async function withSubgraphUrl<T>(fn: () => Promise<T>): Promise<T> {
  const original = config();
  globalThis.__cubicConfig = { ...original, AGENT0_SUBGRAPH_URL: TEST_URL };
  try {
    return await fn();
  } finally {
    globalThis.__cubicConfig = original;
  }
}

beforeAll(async () => {
  await seed();
  const [tenant] = await db().select().from(tenants).where(eq(tenants.slug, config().DEMO_TENANT_SLUG));

  const [labAgent] = await db().select().from(agents)
    .where(and(eq(agents.tenantId, tenant.id), eq(agents.agentKey, "agent:lab-1")));
  const [labTask] = await db().insert(tasks).values({
    tenantId: tenant.id, agentId: labAgent.id, title: "plan-07 lab task (budget 50)",
    budgetUsdCents: 50, status: "open",
  }).returning();
  labTaskId = labTask.id;

  const [graphAgent] = await db().insert(agents).values({
    tenantId: tenant.id, agentKey: "agent:graph-01", name: "graph-test-agent",
    environment: "test", status: "active", erc8004Identity: GRAPH_IDENTITY,
    declaredCapabilities: ["github.get_pull_request"],
  }).returning();
  graphAgentId = graphAgent.id;
  const [graphTask] = await db().insert(tasks).values({
    tenantId: tenant.id, agentId: graphAgent.id, title: "plan-07 graph task (budget 50)",
    budgetUsdCents: 50, status: "open",
  }).returning();
  graphTaskId = graphTask.id;

  const [graphAgent2] = await db().insert(agents).values({
    tenantId: tenant.id, agentKey: "agent:graph-02", name: "graph-test-agent-2",
    environment: "test", status: "active", erc8004Identity: GRAPH_IDENTITY_2,
    declaredCapabilities: ["github.get_pull_request"],
  }).returning();
  graphAgentId2 = graphAgent2.id;
  const [graphTask2] = await db().insert(tasks).values({
    tenantId: tenant.id, agentId: graphAgent2.id, title: "plan-07 graph task 2 (budget 50)",
    budgetUsdCents: 50, status: "open",
  }).returning();
  graphTaskId2 = graphTask2.id;

  const [staticAgent] = await db().select().from(agents)
    .where(and(eq(agents.tenantId, tenant.id), eq(agents.agentKey, "agent:8472")));
  staticAgentId = staticAgent.id;
  const [staticTask] = await db().select().from(tasks)
    .where(and(eq(tasks.tenantId, tenant.id), eq(tasks.agentId, staticAgent.id)));
  staticTaskId = staticTask.id;
}, 30000);

afterAll(async () => {
  // Own pseudonym rows: seed() only deletes fixture pseudonyms (8472, lab-1).
  for (const key of ["agent:graph-01", "agent:graph-02"]) {
    await db().delete(networkEvents).where(eq(networkEvents.agentPseudonym, pseudonymFor(key)));
  }
  await seed(); // demo-tenant rows only: clears gateway artifacts, restores fixtures
  setContextProvider(new AutoContextProvider()); // never leak a stub into the next suite
}, 30000);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("plan-07 graph context", () => {
  it("reputation 0.95 from the Graph → allow (fact is load-bearing)", async () => {
    setContextProvider(new GraphContextProvider(stubClient(highTrust)));
    const result = await runToolCall({
      agent_key: "agent:graph-01",
      tool: "github.get_pull_request",
      arguments: { repo: "acme/backend", pr: 421 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.decision).toBe("allow");
    expect(result.data.matched_policy).toBe("default-v1");
    expect(result.data.matched_rule_id).toBe("default-allow");
    expect(result.data.capability?.capability_id).toMatch(UUID_RE);
  });

  it("fixture identity agent:lab-1 → 0.50 → escalate reputation_below_threshold (no network)", async () => {
    const calls = { count: 0 };
    setContextProvider(new GraphContextProvider(stubClient(highTrust, calls)));
    const result = await runToolCall({
      task_id: labTaskId,
      agent_key: "agent:lab-1",
      tool: "github.get_pull_request",
      arguments: { repo: "acme/backend", pr: 421 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.decision).toBe("escalate");
    expect(result.data.matched_policy).toBe("default-v1");
    expect(result.data.matched_rule_id).toBe("reputation-floor");
    expect(result.data.reasons[0]?.code).toBe("reputation_below_threshold");
    expect(result.data.approval_id).toMatch(UUID_RE);
    expect(result.data.capability).toBeNull();
    expect(calls.count).toBe(0); // fixture short-circuit: client never consulted
  });

  it("subgraph outage → neutral 0.80 → allow + graph-context-fallback warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setContextProvider(new GraphContextProvider(rejectingClient));
    try {
      const result = await runToolCall({
        agent_key: "agent:graph-01",
        tool: "github.get_pull_request",
        arguments: { repo: "acme/backend", pr: 421 },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.decision).toBe("allow"); // neutral 0.80 passes the 0.80 floor
      expect(result.data.capability).not.toBeNull();
      expect(warn).toHaveBeenCalledWith("graph-context-fallback", { identity: GRAPH_IDENTITY });
    } finally {
      warn.mockRestore();
    }

    const facts = await new GraphContextProvider(rejectingClient).getFacts(
      { taskId: graphTaskId, tool: "github.get_pull_request" },
      { agentId: graphAgentId, toolRow: null },
    );
    expect(facts.agent_reputation).toBe(NEUTRAL_REPUTATION);
    expect(facts.agent_status).toBe("active");
    expect(facts.task_budget_usd_cents).toBe(50);
  });

  it("cache: second lookup within the 60s TTL performs zero network calls", async () => {
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify(subgraphPayload([90], { status: "COMPLETED", response: 90 })), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await withSubgraphUrl(async () => {
      const client = new HttpAgent0Client();
      const first = await client.lookup(GRAPH_IDENTITY);
      const second = await client.lookup(GRAPH_IDENTITY);
      expect(first).toEqual({
        identity: GRAPH_IDENTITY,
        reputation: 0.9,
        validation: "passed", // COMPLETED + response 90/100 → passed
        capabilities: ["github.get_pull_request", "risk-analysis"],
      });
      expect(second).toEqual(first);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]?.[0]).toBe(TEST_URL);
      const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}")) as { query?: string };
      expect(body.query).toBe(AGENT0_QUERY);
    });

    // Same guarantee through the provider: two getFacts calls, one fetch.
    const provider = new GraphContextProvider(new HttpAgent0Client());
    await withSubgraphUrl(async () => {
      await provider.getFacts(
        { taskId: graphTaskId, tool: "github.get_pull_request" },
        { agentId: graphAgentId, toolRow: null },
      );
      expect(fetchMock).toHaveBeenCalledTimes(1); // still 1: cached
    });
  });

  it("validation mapping follows the canonical schema enum (UPPERCASE status + response score)", async () => {
    const cases: { id: string; validation: { status: string; response: number | null }; expect: AgentTrust["validation"] }[] = [
      { id: "8453:7001", validation: { status: "COMPLETED", response: 90 }, expect: "passed" },
      { id: "8453:7002", validation: { status: "COMPLETED", response: 20 }, expect: "failed" },
      { id: "8453:7003", validation: { status: "EXPIRED", response: null }, expect: "unknown" },
      { id: "8453:7004", validation: { status: "PENDING", response: 0 }, expect: "unknown" }, // schema: "0 means pending"
    ];
    const responses = new Map(cases.map((c) => [c.id, c.validation]));
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) => {
        const body = JSON.parse(String(_init?.body ?? "{}")) as { variables?: { id?: string } };
        const validation = responses.get(body.variables?.id ?? "");
        return new Response(JSON.stringify(subgraphPayload([80], validation ?? null)), { status: 200 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    await withSubgraphUrl(async () => {
      const client = new HttpAgent0Client();
      for (const c of cases) {
        const trust = await client.lookup(c.id);
        expect(trust.validation).toBe(c.expect);
      }
      expect(fetchMock).toHaveBeenCalledTimes(cases.length); // distinct identities: no cache reuse
    });
  });

  it("selection: URL unset + identity → Static 0.95; URL set + identity → Graph fact", async () => {
    setContextProvider(new AutoContextProvider());
    const intent = { taskId: graphTaskId, tool: "github.get_pull_request" } as const;
    const ctx = { agentId: graphAgentId, toolRow: null } as const;

    // Env-independent: explicitly clear the URL, with a fetch spy proving no network.
    const noFetch = vi.fn();
    vi.stubGlobal("fetch", noFetch);
    const original = config();
    globalThis.__cubicConfig = { ...original, AGENT0_SUBGRAPH_URL: undefined };
    try {
      const facts = await new AutoContextProvider().getFacts(intent, ctx);
      expect(facts.agent_reputation).toBe(0.95); // URL unset → StaticContextProvider
      expect(noFetch).not.toHaveBeenCalled();
    } finally {
      globalThis.__cubicConfig = original;
    }

    const fetchMock = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify(subgraphPayload([72], { status: "COMPLETED", response: 80 }, GRAPH_IDENTITY_2)), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await withSubgraphUrl(async () => {
      const graphFacts = await new AutoContextProvider().getFacts(
        { taskId: graphTaskId2, tool: "github.get_pull_request" },
        { agentId: graphAgentId2, toolRow: null },
      );
      expect(graphFacts.agent_reputation).toBe(0.72); // URL set + erc8004_identity → Graph
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const noIdentity = await new AutoContextProvider().getFacts(
        { taskId: staticTaskId, tool: "github.get_pull_request" },
        { agentId: staticAgentId, toolRow: null },
      );
      expect(noIdentity.agent_reputation).toBe(0.95); // erc8004_identity null → Static even with URL set
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it("GraphContextProvider is plan-02's identical provider interface (Static-compatible swap)", async () => {
    const intent = { taskId: graphTaskId2, tool: "github.get_pull_request" } as const;
    const ctx = { agentId: graphAgentId2, toolRow: null } as const;
    const graph = new GraphContextProvider(stubClient({
      identity: GRAPH_IDENTITY_2,
      reputation: 0.95,
      validation: "unknown",
      capabilities: [],
    }));
    const staticProvider = new StaticContextProvider();
    const [graphFacts, staticFacts] = await Promise.all([
      graph.getFacts(intent, ctx),
      staticProvider.getFacts(intent, ctx),
    ]);
    expect(Object.keys(graphFacts).sort()).toEqual(Object.keys(staticFacts).sort());
    expect(graphFacts.agent_status).toBe(staticFacts.agent_status);
    expect(graphFacts.task_budget_usd_cents).toBe(staticFacts.task_budget_usd_cents);
    expect(graphFacts.budget_spent_usd_cents).toBe(staticFacts.budget_spent_usd_cents);
  });
});
