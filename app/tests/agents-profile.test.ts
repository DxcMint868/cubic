// Agent grants + profile tests — throwaway tenant test-plan-agents.
// Per-agent declaredCapabilities narrow tenant policy (enforced in the
// orchestrator on both transports); the profile API serves names, grants,
// live reputation, and SOUL/MEMORY from a single source.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../src/server/db/client";
import {
  agents, approvals, auditEvents, capabilities, decisions, executions,
  intents, networkEvents, payments, policies, tasks, tenants, tools,
} from "../src/server/db/schema";
import { runToolCall } from "../src/server/gateway/orchestrator";
import { StaticContextProvider, setContextProvider } from "../src/server/gateway/context/provider";
import type { ContextProvider, FactsCtx, FactsIntentRef } from "../src/server/gateway/context/provider";
import { seed } from "../src/server/demo/seed";
import { GET as agentsGET } from "../src/app/api/console/agents/route";
import { GET as profileGET } from "../src/app/api/console/agents/[id]/route";

vi.hoisted(() => {
  process.env.DEMO_TENANT_SLUG = "test-plan-agents";
});

const TENANT = "test-plan-agents";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let tenantId = "";
let taskId = "";
let agent8472Id = "";
let lab1Id = "";
const realProvider = new StaticContextProvider();

function call(agentKey: string, tool: string, args: Record<string, unknown>) {
  return runToolCall({ task_id: taskId, agent_key: agentKey, tool, arguments: args });
}

beforeAll(async () => {
  // Hermetic reputation: static provider for the file (env-independent).
  // Live reads are proven outside vitest (curled 0.1 for lab-1) and covered
  // by e2e.demo with the real key.
  setContextProvider(new StaticContextProvider());
  await seed();
  const [tenant] = await db().select().from(tenants).where(eq(tenants.slug, TENANT));
  tenantId = tenant.id;
  const [a8472] = await db()
    .select()
    .from(agents)
    .where(and(eq(agents.tenantId, tenantId), eq(agents.agentKey, "agent:8472")));
  const [lab1] = await db()
    .select()
    .from(agents)
    .where(and(eq(agents.tenantId, tenantId), eq(agents.agentKey, "agent:lab-1")));
  agent8472Id = a8472.id;
  lab1Id = lab1.id;
  const [task] = await db()
    .insert(tasks)
    .values({ tenantId, agentId: agent8472Id, title: "grants test task", budgetUsdCents: 5000, status: "open" })
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
    await db().delete(tenants).where(eq(tenants.id, t.id));
  }
  for (const key of ["agent:8472", "agent:lab-1"]) {
    const pseudo = createHash("sha256").update(`${key}|cubic-network-v1`).digest("hex").slice(0, 16);
    await db().delete(networkEvents).where(eq(networkEvents.agentPseudonym, pseudo));
  }
  delete process.env.DEMO_TENANT_SLUG;
  setContextProvider(new StaticContextProvider());
  delete (globalThis as Record<string, unknown>).__cubicConfig;
}, 120000);

describe("per-agent grant enforcement", () => {
  it("lab-1 (granted only PR reads) is denied tools outside its grants", async () => {
    const scan = await call("agent:lab-1", "scanner.scan", { target: "acme/backend#421" });
    expect(scan.ok && scan.data.decision).toBe("deny");
    expect(scan.ok && scan.data.matched_rule_id).toBe("agent-grant");
    expect(scan.ok && scan.data.reasons[0]?.code).toBe("tool_not_allowed");
    expect(scan.ok && scan.data.capability).toBeNull();
    expect(scan.ok && scan.data.execution).toBeNull();

    // Merge would escalate for a granted agent — for lab-1 the grant narrows first.
    const merge = await call("agent:lab-1", "github.merge_pull_request", { repo: "acme/backend", pr: 421 });
    expect(merge.ok && merge.data.decision).toBe("deny");
    expect(merge.ok && merge.data.matched_rule_id).toBe("agent-grant");
  }, 60000);

  it("lab-1 keeps its granted read (escalated on reputation, not grants)", async () => {
    const stub: ContextProvider = {
      getFacts: async (intent: FactsIntentRef, ctx: FactsCtx) => ({
        ...(await realProvider.getFacts(intent, ctx)),
        agent_reputation: 0.1,
      }),
    };
    setContextProvider(stub);
    try {
      const read = await call("agent:lab-1", "github.get_pull_request", { repo: "acme/backend", pr: 421 });
      expect(read.ok && read.data.decision).toBe("escalate");
      expect(read.ok && read.data.matched_rule_id).not.toBe("agent-grant");
    } finally {
      setContextProvider(new StaticContextProvider());
    }
  }, 60000);

  it("deploy-agent keeps full outcomes (grant is a narrowing, not a rewrite)", async () => {
    const merge = await call("agent:8472", "github.merge_pull_request", { repo: "acme/backend", pr: 421 });
    expect(merge.ok && merge.data.decision).toBe("escalate");
    expect(merge.ok && merge.data.matched_rule_id).toBe("merge-risk");
  }, 60000);

  it("unknown tools still fall through to the policy allowlist deny", async () => {
    const unknown = await call("agent:8472", "github.delete_repo", { repo: "acme/backend" });
    expect(unknown.ok && unknown.data.decision).toBe("deny");
    expect(unknown.ok && unknown.data.matched_rule_id).toBe("tool-allowlist");
    expect(unknown.ok && unknown.data.reasons[0]?.code).toBe("tool_not_allowed");
  }, 60000);
});

describe("agent registry + profile API", () => {
  it("GET /api/console/agents returns human-readable rows", async () => {
    const res = await agentsGET();
    const body = (await res.json()) as {
      ok: boolean;
      data: Array<{ id: string; agent_key: string; name: string; environment: string; status: string }>;
    };
    expect(body.ok).toBe(true);
    const byKey = new Map(body.data.map((a) => [a.agent_key, a]));
    expect(byKey.get("agent:8472")?.name).toBe("deploy-agent");
    expect(byKey.get("agent:lab-1")?.name).toBe("low-rep-research-agent");
    for (const row of body.data) expect(row.id).toMatch(UUID_RE);
  }, 30000);

  it("deploy-agent profile: grants, MCP origins, static reputation, docs", async () => {
    const res = await profileGET(new Request("http://test/console/agents/x"), {
      params: Promise.resolve({ id: agent8472Id }),
    });
    const body = (await res.json()) as {
      ok: boolean;
      data: {
        agent_key: string;
        name: string;
        erc8004_identity: string | null;
        reputation: { score: number; source: string; identity: string | null };
        granted_tools: Array<{ name: string; origin: string }>;
        ungranted_tools: Array<{ name: string }>;
        soul: string | null;
        memory: string | null;
      };
    };
    expect(body.ok).toBe(true);
    expect(body.data.agent_key).toBe("agent:8472");
    expect(body.data.name).toBe("deploy-agent");
    expect(body.data.erc8004_identity).toBe("84532:9223");
    // Source depends on live graph config (static hermetic / live / fallback);
    // shape + identity echo are the contract here.
    expect(body.data.reputation.identity).toBe("84532:9223");
    expect(["agent0-subgraph", "offline-fallback", "static"]).toContain(body.data.reputation.source);
    expect(body.data.reputation.score).toBeGreaterThanOrEqual(0);
    expect(body.data.reputation.score).toBeLessThanOrEqual(1);
    expect(body.data.granted_tools.map((t) => t.name).sort()).toEqual(
      ["deploy.production", "github.get_pull_request", "github.merge_pull_request", "github.read_file", "scanner.scan", "task.complete"].sort(),
    );
    const origins = new Map(body.data.granted_tools.map((t) => [t.name, t.origin]));
    expect(origins.get("scanner.scan")).toBe("mcp");
    expect(origins.get("github.merge_pull_request")).toBe("mcp");
    expect(origins.get("deploy.production")).toBe("direct");
    expect(body.data.ungranted_tools).toEqual([]);
    expect(body.data.soul).toContain("I am the deploy agent");
    expect(body.data.memory).toContain("PR #421");
  }, 30000);

  it("lab-1 profile: one grant, the rest denied, live-or-fallback reputation", async () => {
    const res = await profileGET(new Request("http://test/console/agents/x"), {
      params: Promise.resolve({ id: lab1Id }),
    });
    const body = (await res.json()) as {
      ok: boolean;
      data: {
        reputation: { score: number; source: string; identity: string | null };
        granted_tools: Array<{ name: string }>;
        ungranted_tools: Array<{ name: string }>;
        soul: string | null;
        memory: string | null;
      };
    };
    expect(body.ok).toBe(true);
    expect(body.data.granted_tools.map((t) => t.name)).toEqual(["github.get_pull_request"]);
    expect(body.data.ungranted_tools.map((t) => t.name)).toContain("scanner.scan");
    expect(body.data.ungranted_tools.map((t) => t.name)).toContain("github.merge_pull_request");
    expect(body.data.reputation.identity).toBe("8453:74108");
    expect(["agent0-subgraph", "offline-fallback", "static"]).toContain(body.data.reputation.source);
    expect(body.data.soul).toContain("damaged reputation");
    expect(body.data.memory).toContain("8453:74108");
  }, 30000);

  it("unknown agent id is a 404", async () => {
    const res = await profileGET(new Request("http://test/console/agents/x"), {
      params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000000" }),
    });
    expect(res.status).toBe(404);
  }, 30000);
});
