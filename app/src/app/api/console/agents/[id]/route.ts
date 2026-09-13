// Agent profile: identity, granted tools (the enforced per-agent grants),
// live reputation, and the agent's own SOUL.md / MEMORY.md. Everything the
// console renders about an agent comes from this one endpoint so the list,
// the detail page, and the gateway enforcement all read the same source.
import { readFile } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { config } from "@/server/config";
import { db } from "@/server/db/client";
import { agents, tenants, tools } from "@/server/db/schema";
import { HttpAgent0Client } from "@/server/graph/agent0";
import { NEUTRAL_REPUTATION } from "@/server/gateway/context/graphProvider";

export const dynamic = "force-dynamic";

// Gateway tools served through the MCP facade (sdk names in
// server/mcp/server.ts). Everything else runs executors directly.
const MCP_GATEWAY_TOOLS: ReadonlySet<string> = new Set([
  "scanner.scan",
  "github.get_pull_request",
  "github.read_file",
  "github.merge_pull_request",
  "task.complete",
]);

function docsDir(agentKey: string): string {
  const safe = agentKey.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  return `${process.cwd()}/data/agents/${safe}`;
}

async function readDoc(agentKey: string, file: "SOUL.md" | "MEMORY.md"): Promise<string | null> {
  try {
    const text = await readFile(`${docsDir(agentKey)}/${file}`, "utf8");
    return text.trim() === "" ? null : text;
  } catch {
    return null;
  }
}

interface Reputation {
  score: number;
  source: "agent0-subgraph" | "offline-fallback" | "static";
  identity: string | null;
  validation: "passed" | "failed" | "unknown";
  capabilities: string[];
  feedbackCount: number;
}

// Verified URLs: the Agent0 subgraph docs, plus the explorer playground with
// the agent query PRE-FILLED via the ?query= param (the explorer UI pre-loads
// it into the editor; running it is one click — auto-run is not a documented
// explorer behavior, so the UI never claims it).
const SUBGRAPH_DOCS_URL = "https://thegraph.com/docs/en/subgraphs/existing-subgraphs/agent0/";
const SUBGRAPH_PLAYGROUND_BASE =
  "https://thegraph.com/explorer/subgraphs/4yYAvQLFjBhBtdRCY7eUWo181VNoTSLLFd5M7FXQAi6u?view=Query&chain=arbitrum-one&query=";

export function subgraphPlaygroundUrl(identity: string): string {
  const query = `query {\n  agent(id: "${identity}") {\n    id\n    owner\n    registrationFile { name description }\n    feedback(where: { isRevoked: false }) { value clientAddress }\n    validations(first: 1) { status response }\n  }\n}`;
  return SUBGRAPH_PLAYGROUND_BASE + encodeURIComponent(query);
}

// Same semantics as AutoContextProvider: a real identity + graph config reads
// the live subgraph (full trust object); anything else is the labeled static
// default. Never throws.
async function readReputation(identity: string | null): Promise<Reputation> {
  if (identity && (config().AGENT0_SUBGRAPH_URL || config().THEGRAPH_API_KEY)) {
    try {
      const lookup = new Promise<{ reputation: number; validation: Reputation["validation"]; capabilities: string[]; feedbackCount: number }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("reputation lookup timed out")), 5000);
        new HttpAgent0Client()
          .lookup(identity)
          .then((trust) => {
            clearTimeout(timer);
            resolve(trust);
          })
          .catch((err: unknown) => {
            clearTimeout(timer);
            reject(err instanceof Error ? err : new Error(String(err)));
          });
      });
      const trust = await lookup;
      return {
        score: trust.reputation,
        source: "agent0-subgraph",
        identity,
        validation: trust.validation,
        capabilities: trust.capabilities,
        feedbackCount: trust.feedbackCount,
      };
    } catch {
      return { score: NEUTRAL_REPUTATION, source: "offline-fallback", identity, validation: "unknown", capabilities: [], feedbackCount: 0 };
    }
  }
  return { score: 0.95, source: "static", identity, validation: "unknown", capabilities: [], feedbackCount: 0 };
}

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const [tenant] = await db().select().from(tenants).where(eq(tenants.slug, config().DEMO_TENANT_SLUG));
    if (!tenant) {
      return Response.json(
        { ok: false, error: { code: "TASK_NOT_FOUND", message: "demo tenant missing" } },
        { status: 404 },
      );
    }
    const [agent] = await db()
      .select()
      .from(agents)
      .where(and(eq(agents.id, id), eq(agents.tenantId, tenant.id)));
    if (!agent) {
      return Response.json(
        { ok: false, error: { code: "AGENT_NOT_FOUND", message: `agent not found: ${id}` } },
        { status: 404 },
      );
    }
    const toolRows = await db().select().from(tools).where(eq(tools.tenantId, tenant.id));
    const grants = new Set((agent.declaredCapabilities ?? []) as string[]);
    const [reputation, soul, memory] = await Promise.all([
      readReputation(agent.erc8004Identity),
      readDoc(agent.agentKey, "SOUL.md"),
      readDoc(agent.agentKey, "MEMORY.md"),
    ]);
    return Response.json({
      ok: true,
      data: {
        id: agent.id,
        agent_key: agent.agentKey,
        name: agent.name,
        environment: agent.environment,
        status: agent.status,
        erc8004_identity: agent.erc8004Identity,
        reputation,
        subgraph_docs_url: SUBGRAPH_DOCS_URL,
        subgraph_playground_url: agent.erc8004Identity
          ? subgraphPlaygroundUrl(agent.erc8004Identity)
          : SUBGRAPH_DOCS_URL,
        granted_tools: toolRows
          .filter((t) => grants.has(t.name))
          .map((t) => ({
            name: t.name,
            category: t.category,
            risk_class: t.defaultRiskClass,
            origin: MCP_GATEWAY_TOOLS.has(t.name) ? "mcp" : "direct",
          })),
        ungranted_tools: toolRows
          .filter((t) => !grants.has(t.name))
          .map((t) => ({
            name: t.name,
            category: t.category,
            risk_class: t.defaultRiskClass,
            origin: MCP_GATEWAY_TOOLS.has(t.name) ? "mcp" : "direct",
          })),
        soul,
        memory,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: { code: "INTERNAL", message } }, { status: 500 });
  }
}
