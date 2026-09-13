// plan-16 chat-route e2e — throwaway tenant test-plan-16 seeded with the
// EXACT demo fixtures, extended in-test with the treasury graft (same idiom
// as treasury.test.ts). A loopback HTTP server wraps the real MCP + scanner
// route handlers so the MCP-client transport path runs for real in-process.
// Never touches the demo tenant.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { db } from "../src/server/db/client";
import {
  agents, approvals, auditEvents, capabilities, councils, decisions, executions,
  intents, networkEvents, payments, policies, tasks, tenants, tools,
} from "../src/server/db/schema";
import { runToolCall } from "../src/server/gateway/orchestrator";
import { seed } from "../src/server/demo/seed";
import { CHAT_TEMPLATES, PLAY_BEATS, getTemplate } from "../src/server/demo/templates";
import { validateParsed, parseFreeText } from "../src/server/demo/parse";
import { clearMcpCacheForTests } from "../src/server/demo/chat";
import { loadAgentIdentity } from "../src/server/demo/identity";
import { buildSystemPrompt } from "../src/server/demo/parse";
import { StaticContextProvider, setContextProvider } from "../src/server/gateway/context/provider";
import type { ContextProvider, FactsCtx, FactsIntentRef } from "../src/server/gateway/context/provider";
import { POST as mcpPOST } from "../src/app/api/mcp/route";
import { POST as scannerPOST } from "../src/app/api/services/scanner/scan/route";
import { GET as chatGET, POST as chatPOST } from "../src/app/api/demo/chat/route";
import type { Rule } from "../src/server/gateway/policy/engine";

vi.hoisted(() => {
  process.env.DEMO_TENANT_SLUG = "test-plan-16";
});

const TENANT = "test-plan-16";
const TAGENT = "agent:chat-1";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_TOOL_MESSAGE = "No tool matched — nothing was sent to the gateway";

const TREASURY_TOOLS = [
  { name: "treasury.swap", category: "treasury", defaultRiskClass: "high", executor: "treasury", executorConfig: {} },
  { name: "treasury.transfer", category: "treasury", defaultRiskClass: "high", executor: "treasury", executorConfig: {} },
  { name: "treasury.stake", category: "treasury", defaultRiskClass: "medium", executor: "treasury", executorConfig: {} },
] as const;

let tenantId = "";
let loopback = "";
let closeLoopback: () => void = () => undefined;
let savedChatModel: string | undefined;
let savedHcsTopic: string | undefined;

function startLoopback(): Promise<{ url: string; close: () => void }> {
  const server = http.createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const port = (server.address() as AddressInfo).port;
      const webReq = new Request(`http://127.0.0.1:${port}${req.url ?? "/"}`, {
        method: req.method ?? "POST",
        headers: req.headers as Record<string, string>,
        body: chunks.length ? Buffer.concat(chunks) : undefined,
      });
      let webRes: Response;
      if (req.url?.startsWith("/api/mcp")) {
        webRes = await mcpPOST(webReq);
      } else if (req.url?.startsWith("/api/services/scanner/scan")) {
        webRes = await scannerPOST(webReq);
      } else {
        res.statusCode = 404;
        res.end("unknown loopback path");
        return;
      }
      res.statusCode = webRes.status;
      for (const [key, value] of webRes.headers) res.setHeader(key, value);
      res.end(Buffer.from(await webRes.arrayBuffer()));
    } catch (err) {
      res.statusCode = 500;
      res.end(err instanceof Error ? err.message : String(err));
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

interface ChatTurnBody {
  kind: string;
  template_id: string | null;
  chat_text: string;
  client_label: string;
  reply: string | null;
  task_id: string | null;
  tool: string | null;
  arguments: Record<string, unknown>;
  transport: string | null;
  intent: Record<string, unknown> | null;
  decision: string | null;
  matched_policy: string | null;
  matched_rule_id: string | null;
  reasons: Array<{ code: string }>;
  risk_score: number | null;
  approval: { id: string; provider: string; status: string } | null;
  approval_outcome: string | null;
  capability: { capability_id: string; action: string; nonce: string } | null;
  execution: { status: string; result_summary: string | null } | null;
  payment: unknown;
  payment_required: { price_usd_cents: number } | null;
  lines: Record<string, string>;
  receipt: { amount_usd_cents: number; network: string; ref: string; ref_kind: string } | null;
  rejections: Array<{ step: string; reason: string; capability_id: string }>;
  anchors: Array<{ event_type: string; fingerprint: string; topic_id: string | null; topic_url: string | null }>;
  trace_url: string | null;
  network_url: string;
  provider: { configured: boolean; model: string };
  tools: { connected: number | null };
  no_tool_message: string | null;
}

async function chat(body: Record<string, unknown>): Promise<{ status: number; json: { ok: boolean; data?: { intent: unknown; decision: string | null; trace_url: string | null; network_url: string; turn: ChatTurnBody }; error?: { code: string; message: string } } }> {
  const res = await chatPOST(
    new Request(`${loopback}/api/demo/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, json: (await res.json()) as never };
}

beforeAll(async () => {
  // Parser tests must see true absence even if the dev env carries a key or
  // a model override — remove both for the duration (restored in afterAll).
  delete process.env.OPENROUTER_API_KEY;
  savedChatModel = process.env.CHAT_MODEL;
  delete process.env.CHAT_MODEL;
  savedHcsTopic = process.env.HCS_TOPIC_ID;
  delete process.env.HCS_TOPIC_ID;
  await seed();
  const [tenant] = await db().select().from(tenants).where(eq(tenants.slug, TENANT));
  tenantId = tenant.id;

  await db().insert(tools).values(
    TREASURY_TOOLS.map((t) => ({
      tenantId,
      name: t.name,
      category: t.category,
      defaultRiskClass: t.defaultRiskClass,
      executor: t.executor,
      executorConfig: { ...t.executorConfig },
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

  const started = await startLoopback();
  loopback = started.url;
  closeLoopback = started.close;
  // Point the seeded scanner executor at the loopback of the real scan route.
  await db()
    .update(tools)
    .set({ executorConfig: { endpoint: `${loopback}/api/services/scanner/scan` } })
    .where(and(eq(tools.tenantId, tenantId), eq(tools.name, "scanner.scan")));
}, 120000);

afterAll(async () => {
  closeLoopback();
  clearMcpCacheForTests();
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
  for (const key of [TAGENT, "agent:8472"]) {
    const pseudo = createHash("sha256").update(`${key}|cubic-network-v1`).digest("hex").slice(0, 16);
    await db().delete(networkEvents).where(eq(networkEvents.agentPseudonym, pseudo));
  }
  delete process.env.DEMO_TENANT_SLUG;
  if (savedChatModel !== undefined) process.env.CHAT_MODEL = savedChatModel;
  if (savedHcsTopic !== undefined) process.env.HCS_TOPIC_ID = savedHcsTopic;
  delete (globalThis as Record<string, unknown>).__cubicConfig;
}, 120000);

describe("plan-16 chat bootstrap (GET)", () => {
  it("returns templates + templates-only provider state + 5-tools chip", async () => {
    const res = await chatGET(new Request(`${loopback}/api/demo/chat`));
    const body = (await res.json()) as {
      ok: boolean;
      data: { templates: Array<{ id: string; label: string; chat_text: string }>; provider: { configured: boolean; model: string }; tools: { connected: number | null }; client_label: string };
    };
    expect(body.ok).toBe(true);
    expect(body.data.templates.map((t) => t.id)).toEqual(CHAT_TEMPLATES.map((t) => t.id));
    expect(body.data.provider.configured).toBe(false);
    expect(body.data.provider.model).toBe("openai/gpt-4o-mini");
    expect(body.data.tools.connected).toBe(5);
    expect(body.data.client_label).toBe("Demo agent (MCP client)");
  }, 60000);
});

describe("plan-16 Play beat order", () => {
  it("beats run hands-free in order with the cataloged decisions", async () => {
    expect(PLAY_BEATS.map((b) => b.template_id)).toEqual([
      null,
      "deploy-read",
      "deploy-scan",
      "deploy-merge",
      "attack-env",
      "attack-overbudget",
      null,
    ]);
    // Literal narration cues: every Play cue must appear verbatim in the
    // video runbook (docs/demo.md) — the plan's "literal" clause, asserted.
    const demoMd = await readFile(new URL("../../docs/demo.md", import.meta.url), "utf8");
    for (const beat of PLAY_BEATS) expect(demoMd).toContain(beat.cue);
    for (const beat of PLAY_BEATS) {
      if (!beat.template_id) continue;
      const template = getTemplate(beat.template_id)!;
      const { status, json } = await chat({ template_id: beat.template_id });
      expect(status).toBe(200);
      expect(json.ok).toBe(true);
      const turn = json.data!.turn;
      expect(turn.decision).toBe(template.expect.decision);
      expect(turn.reasons[0]?.code).toBe(template.expect.reason);
      if (template.reply) expect(turn.reply).toBe(template.reply);
      expect(turn.trace_url).toMatch(/^\/console\/tasks\//);
      expect(turn.network_url).toBe("/network");
      expect(turn.client_label).toBe("Demo agent (MCP client)");
    }
  }, 180000);

  it("scan beat carries the discovery receipt; merge beat carries reason + provider badge", async () => {
    const scan = await chat({ template_id: "deploy-scan" });
    const scanTurn = scan.json.data!.turn;
    expect(scanTurn.decision).toBe("allow");
    expect(scanTurn.payment_required?.price_usd_cents).toBe(25);
    expect(scanTurn.receipt).toMatchObject({ amount_usd_cents: 25, network: "hedera", ref_kind: "challenge" });
    expect(scanTurn.receipt!.ref).toHaveLength(8);

    const merge = await chat({ template_id: "deploy-merge" });
    const mergeTurn = merge.json.data!.turn;
    expect(mergeTurn.decision).toBe("escalate");
    expect(mergeTurn.approval?.id).toMatch(UUID_RE);
    expect(mergeTurn.approval?.provider).toBe("dev");
    expect(mergeTurn.transport).toBe("mcp");
  }, 120000);
});

describe("plan-16 templates: deploy + treasury", () => {
  it("deploy-run escalates (risk_requires_approval) via the gateway path", async () => {
    const { json } = await chat({ template_id: "deploy-run" });
    expect(json.ok).toBe(true);
    const turn = json.data!.turn;
    expect(turn.transport).toBe("gateway");
    expect(turn.decision).toBe("escalate");
    expect(turn.matched_rule_id).toBe("risk-approval");
    expect(turn.reasons[0]?.code).toBe("risk_requires_approval");
    expect(turn.intent).toMatchObject({ tool: "deploy.production", action: "deploy_production" });
  }, 60000);

  it("treasury story: swap/payroll escalate, stake pair splits, drain rejects", async () => {
    for (const id of ["treasury-swap", "treasury-payroll", "treasury-stake-small", "treasury-stake-large"] as const) {
      const template = getTemplate(id)!;
      const { json } = await chat({ template_id: id });
      expect(json.ok).toBe(true);
      expect(json.data!.turn.decision).toBe(template.expect.decision);
      expect(json.data!.turn.reasons[0]?.code).toBe(template.expect.reason);
    }
    const drain = await chat({ template_id: "treasury-drain" });
    expect(drain.json.ok).toBe(true);
    const drainTurn = drain.json.data!.turn;
    expect(drainTurn.kind).toBe("lifecycle");
    expect(drainTurn.decision).toBe("escalate");
    expect(drainTurn.approval_outcome).toBe("rejected");
    expect(drainTurn.capability).toBeNull();
    expect(drainTurn.execution).toBeNull();
  }, 180000);
});

describe("plan-16 templates: surfaced branches", () => {
  it("cross-task read + unknown tool deny with the enforced reason codes", async () => {
    const cross = await chat({ template_id: "branch-cross-task" });
    expect(cross.json.data!.turn.decision).toBe("deny");
    expect(cross.json.data!.turn.reasons[0]?.code).toBe("resource_outside_task");
    expect(cross.json.data!.turn.matched_rule_id).toBe("deny-cross-task");

    const unknown = await chat({ template_id: "branch-unknown-tool" });
    expect(unknown.json.data!.turn.decision).toBe("deny");
    expect(unknown.json.data!.turn.reasons[0]?.code).toBe("tool_not_allowed");
    expect(unknown.json.data!.turn.transport).toBe("gateway");
  }, 120000);

  it("replay + expired capabilities reject through the real consume path", async () => {
    const replay = await chat({ template_id: "branch-replay" });
    expect(replay.json.data!.turn.decision).toBe("allow");
    expect(replay.json.data!.turn.rejections).toHaveLength(1);
    expect(replay.json.data!.turn.rejections[0]?.reason).toBe("replay");

    const expired = await chat({ template_id: "branch-expired" });
    expect(expired.json.data!.turn.rejections[0]?.reason).toBe("expired");
  }, 120000);
});

describe("plan-16 adversarial display + no-provider templates-only", () => {
  it("camera beats deny with zero executions", async () => {
    const env = await chat({ template_id: "attack-env" });
    expect(env.json.data!.turn.decision).toBe("deny");
    expect(env.json.data!.turn.reasons[0]?.code).toBe("secret_resource");
    expect(env.json.data!.turn.capability).toBeNull();
    expect(env.json.data!.turn.execution).toBeNull();
    expect(env.json.data!.turn.payment).toBeNull();

    const over = await chat({ template_id: "attack-overbudget" });
    expect(over.json.data!.turn.decision).toBe("deny");
    expect(over.json.data!.turn.reasons[0]?.code).toBe("budget_exceeded");
    expect(over.json.data!.turn.payment).toBeNull();
    expect(over.json.data!.turn.execution).toBeNull();
    expect(over.json.data!.turn.capability).toBeNull();
  }, 120000);

  it("no-tool template never touches the gateway", async () => {
    const countBefore = (
      await db().select().from(intents).where(eq(intents.agentId, (await db().select().from(agents).where(and(eq(agents.tenantId, tenantId), eq(agents.agentKey, "agent:8472"))))[0].id))
    ).length;
    const { json } = await chat({ template_id: "no-tool-hello" });
    expect(json.ok).toBe(true);
    const turn = json.data!.turn;
    expect(turn.kind).toBe("no-tool");
    expect(turn.tool).toBeNull();
    expect(turn.intent).toBeNull();
    expect(turn.decision).toBeNull();
    expect(turn.no_tool_message).toBe(NO_TOOL_MESSAGE);
    // A turn with zero gateway rows links nowhere — never to a trace of
    // other turns' Decisions.
    expect(turn.trace_url).toBeNull();
    const countAfter = (
      await db().select().from(intents).where(eq(intents.agentId, (await db().select().from(agents).where(and(eq(agents.tenantId, tenantId), eq(agents.agentKey, "agent:8472"))))[0].id))
    ).length;
    expect(countAfter).toBe(countBefore);
  }, 60000);

  it("free text without provider → honest disabled no-tool state with the speaker's voice", async () => {
    const { json } = await chat({ message: "merge PR 421 please" });
    expect(json.ok).toBe(true);
    const turn = json.data!.turn;
    expect(turn.kind).toBe("no-tool");
    expect(turn.tool).toBeNull();
    expect(turn.provider.configured).toBe(false);
    expect(turn.no_tool_message).toBe(NO_TOOL_MESSAGE);
    // The agent still speaks AS itself: deploy-agent's redirect, never a
    // bare fallback or another agent's voice.
    expect(turn.reply).toContain("deploy-agent");
    expect(turn.reply).toContain("agent:8472");
    expect(turn.reply).toContain("scenario below");
  }, 60000);

  it("treasury speaker gets treasury's redirect voice, not deploy-speak", async () => {
    const { json } = await chat({ message: "merge PR 421 please", agent_key: "agent:treasury" });
    expect(json.ok).toBe(true);
    const turn = json.data!.turn;
    expect(turn.kind).toBe("no-tool");
    expect(turn.reply).toContain("treasury-agent");
    expect(turn.reply).toContain("treasury.swap");
    expect(turn.reply).not.toContain("deploy-agent");
  }, 60000);

  it("unknown template id is a 400", async () => {
    const { status, json } = await chat({ template_id: "nope" });
    expect(status).toBe(400);
    expect(json.ok).toBe(false);
  }, 60000);
});

describe("plan-16 chat-vs-ingest event identity", () => {
  it("same template through MCP chat and direct ingest → identical chains", async () => {
    const { json } = await chat({ template_id: "deploy-read" });
    expect(json.ok).toBe(true);
    const turn = json.data!.turn;
    expect(turn.transport).toBe("mcp");

    // The turn renders its own HCS anchors: the allowlisted chain events with
    // display-identical fingerprints, topic real-or-absent.
    expect(turn.anchors.map((a) => a.event_type)).toEqual([
      "policy.evaluated",
      "capability.issued",
      "capability.consumed",
    ]);
    for (const anchor of turn.anchors) {
      expect(anchor.fingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(anchor.topic_id).toBeNull();
      expect(anchor.topic_url).toBeNull();
    }

    const direct = await runToolCall({
      task_id: turn.task_id!,
      agent_key: "agent:8472",
      tool: "github.get_pull_request",
      arguments: { repo: "acme/backend", pr: 421 },
    });
    expect(direct.ok).toBe(true);
    if (!direct.ok) throw new Error("unreachable");
    expect(direct.data.decision).toBe(turn.decision);
    expect(direct.data.matched_policy).toBe(turn.matched_policy);
    expect(direct.data.matched_rule_id).toBe(turn.matched_rule_id);
    expect(direct.data.reasons).toEqual(turn.reasons.map((r) => ({ code: r.code })));

    const [directIntent] = await db()
      .select()
      .from(intents)
      .where(eq(intents.id, direct.data.intent_id));
    const directNorm = { ...(directIntent.normalized as unknown as Record<string, unknown>) };
    const turnNorm = { ...(turn.intent as unknown as Record<string, unknown>) };
    expect(directNorm).toEqual(turnNorm);
  }, 120000);
});

describe("plan-16 chat sessions land in tasks", () => {
  it("first turn mints a Chat task; pinned turns share it; template.spec still mints fresh", async () => {
    const first = await chat({ template_id: "deploy-read" });
    const sessionTask = first.json.data!.turn.task_id;
    expect(sessionTask).toMatch(UUID_RE);

    const second = await chat({ template_id: "deploy-read", task_id: sessionTask! });
    expect(second.json.data!.turn.task_id).toBe(sessionTask);

    const [taskRow] = await db().select().from(tasks).where(eq(tasks.id, sessionTask!));
    expect(taskRow.title.startsWith("Chat:")).toBe(true);

    const over = await chat({ template_id: "attack-overbudget", task_id: sessionTask! });
    const beatTask = over.json.data!.turn.task_id;
    expect(beatTask).toMatch(UUID_RE);
    expect(beatTask).not.toBe(sessionTask);
    expect(over.json.data!.turn.reasons[0]?.code).toBe("budget_exceeded");
  }, 120000);

  it("lab-1 beat escalates on live-or-stubbed low reputation", async () => {
    const realProvider = new StaticContextProvider();
    const stub: ContextProvider = {
      getFacts: async (intent: FactsIntentRef, ctx: FactsCtx) => ({
        ...(await realProvider.getFacts(intent, ctx)),
        agent_reputation: 0.1,
      }),
    };
    setContextProvider(stub);
    try {
      const { json } = await chat({ template_id: "branch-low-rep" });
      expect(json.ok).toBe(true);
      expect(json.data!.turn.decision).toBe("escalate");
      expect(json.data!.turn.reasons[0]?.code).toBe("reputation_below_threshold");
      expect(json.data!.turn.reply).toContain("lab-1");
    } finally {
      setContextProvider(new StaticContextProvider());
    }
  }, 120000);
});

describe("plan-16 parse.ts (pure, off-camera)", () => {
  it("validates the 5 MCP shapes, passes other gateway tools through for policy to decide", () => {
    expect(validateParsed({ tool: "github.get_pull_request", arguments: { repo: "acme/backend", pr: 421 } }))
      .toEqual({ tool: "github.get_pull_request", arguments: { repo: "acme/backend", pr: 421 } });
    // Disallowed-but-real tools pass through verbatim — the gateway (never the
    // LLM) DENYs them with the enforced reason code (e.g. tool_not_allowed).
    expect(validateParsed({ tool: "github.delete_repo", arguments: { repo: "x" } }))
      .toEqual({ tool: "github.delete_repo", arguments: { repo: "x" } });
    expect(validateParsed({ tool: "deploy.production", arguments: { repo: "acme/backend" } }))
      .toEqual({ tool: "deploy.production", arguments: { repo: "acme/backend" } });
    // MCP shapes stay strict; non-tool strings stay no-tool.
    expect(validateParsed({ tool: "github.read_file", arguments: { repo: "x" } }).tool).toBeNull();
    expect(validateParsed({ tool: null, arguments: {} }).tool).toBeNull();
    expect(validateParsed("slur or off-scope prose").tool).toBeNull();
    expect(validateParsed({ tool: "nope", arguments: {} }).tool).toBeNull();
  });

  it("forgives near-miss drafts: default repo/target, coerce pr", () => {
    // "Read PR number 12" — model omits the repo, pr may arrive as a string.
    expect(validateParsed({ tool: "github.get_pull_request", arguments: { pr: 12 } }))
      .toEqual({ tool: "github.get_pull_request", arguments: { repo: "acme/backend", pr: 12 } });
    expect(validateParsed({ tool: "github.get_pull_request", arguments: { pr: "12" } }))
      .toEqual({ tool: "github.get_pull_request", arguments: { repo: "acme/backend", pr: 12 } });
    expect(validateParsed({ tool: "scanner.scan", arguments: {} }))
      .toEqual({ tool: "scanner.scan", arguments: { target: "acme/backend#421" } });
    // Explicit values are never overridden.
    expect(validateParsed({ tool: "github.get_pull_request", arguments: { repo: "other/repo", pr: 7 } }))
      .toEqual({ tool: "github.get_pull_request", arguments: { repo: "other/repo", pr: 7 } });
    // Garbage pr still fails.
    expect(validateParsed({ tool: "github.get_pull_request", arguments: { pr: "twelve" } }).tool).toBeNull();
  });

  it("passes the model-drafted reply through, drops junk", () => {
    expect(
      validateParsed({ tool: "task.complete", arguments: {}, reply: "Wrapping up now." }).reply,
    ).toBe("Wrapping up now.");
    expect(
      validateParsed({ tool: "task.complete", arguments: {}, reply: "x".repeat(281) }).reply,
    ).toBeUndefined();
    expect(
      validateParsed({ tool: "nope", arguments: {}, reply: "I can't do that." }).reply,
    ).toBe("I can't do that.");
  });
});

describe("plan-16 chat agent picker", () => {
  it("GET lists demo agents and each template's owning agent", async () => {
    const res = await chatGET(new Request(`${loopback}/api/demo/chat`));
    const body = (await res.json()) as {
      ok: boolean;
      data: {
        agents: Array<{ agent_key: string; name: string }>;
        templates: Array<{ id: string; agent_key: string }>;
      };
    };
    expect(body.ok).toBe(true);
    expect(body.data.agents.map((a) => a.agent_key).sort()).toEqual(
      ["agent:8472", "agent:lab-1", "agent:reader", "agent:treasury"].sort(),
    );
    const byId = new Map(body.data.templates.map((t) => [t.id, t.agent_key]));
    expect(byId.get("deploy-read")).toBe("agent:8472");
    expect(byId.get("treasury-swap")).toBe("agent:treasury");
    expect(byId.get("branch-low-rep")).toBe("agent:lab-1");
  }, 60000);

  it("agent_key override speaks as another agent (reader reads PR 421)", async () => {
    const { json } = await chat({ template_id: "deploy-read", agent_key: "agent:reader" });
    expect(json.ok).toBe(true);
    const turn = json.data!.turn;
    expect(turn.decision).toBe("allow");
    const [taskRow] = await db().select().from(tasks).where(eq(tasks.id, turn.task_id!));
    const [reader] = await db()
      .select()
      .from(agents)
      .where(and(eq(agents.tenantId, tenantId), eq(agents.agentKey, "agent:reader")));
    expect(taskRow.agentId).toBe(reader.id);
  }, 60000);

  it("unknown agent_key is a 400", async () => {
    const { status, json } = await chat({ template_id: "deploy-read", agent_key: "agent:nope" });
    expect(status).toBe(400);
    expect(json.ok).toBe(false);
  }, 60000);

  it("pinned task from another agent's session mints fresh instead of merging", async () => {
    const first = await chat({ template_id: "deploy-read" });
    const taskA = first.json.data!.turn.task_id!;
    const second = await chat({ template_id: "deploy-read", task_id: taskA, agent_key: "agent:reader" });
    const taskB = second.json.data!.turn.task_id!;
    expect(taskB).not.toBe(taskA);
    const [rowB] = await db().select().from(tasks).where(eq(tasks.id, taskB));
    const [reader] = await db()
      .select()
      .from(agents)
      .where(and(eq(agents.tenantId, tenantId), eq(agents.agentKey, "agent:reader")));
    expect(rowB.agentId).toBe(reader.id);
  }, 60000);
});

describe("plan-16 agent identity (SOUL/MEMORY → prompt)", () => {
  it("loads the speaking agent's docs from disk", async () => {
    const identity = await loadAgentIdentity("agent:treasury", "treasury-agent", ["treasury.swap"]);
    expect(identity.soul).toContain("treasury agent");
    expect(identity.memory).not.toBeNull();
    expect(identity.tools).toEqual(["treasury.swap"]);
  });

  it("missing docs degrade to nulls, never throw", async () => {
    const identity = await loadAgentIdentity("agent:does-not-exist", "ghost", []);
    expect(identity.soul).toBeNull();
    expect(identity.memory).toBeNull();
  });

  it("system prompt speaks AS the agent with its tools", () => {
    const prompt = buildSystemPrompt({
      key: "agent:treasury",
      name: "treasury-agent",
      soul: "I move the CIO's money.",
      memory: null,
      tools: ["treasury.swap", "task.complete"],
    });
    expect(prompt).toContain("You ARE treasury-agent (agent:treasury)");
    expect(prompt).toContain("I move the CIO's money.");
    expect(prompt).toContain("treasury.swap");
    // The mapping contract survives the identity block.
    expect(prompt).toContain("STRICT JSON");
  });

  it("parseFreeText sends the identity prompt to the provider", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    try {
      let system = "";
      const out = await parseFreeText("hi, who are you", {
        fetchImpl: (async (_url: unknown, init: { body: string }) => {
          system = (JSON.parse(init.body as string) as { messages: Array<{ content: string }> }).messages[0].content;
          return {
            ok: true,
            json: async () => ({ choices: [{ message: { content: '{"tool": null, "arguments": {}, "reply": "I am the treasury agent."}' } }] }),
          } as unknown as Response;
        }) as unknown as typeof fetch,
        agent: { key: "agent:treasury", name: "treasury-agent", soul: "I move money.", tools: ["treasury.swap"] },
      });
      expect(system).toContain("treasury-agent");
      expect(system).toContain("I move money.");
      expect(out.tool).toBeNull();
      expect(out.reply).toBe("I am the treasury agent.");
    } finally {
      delete process.env.OPENROUTER_API_KEY;
    }
  });
});

describe("plan-16 parseFreeText refusal voice (mocked provider)", () => {
  const jsonResponse = (content: string) =>
    ({
      ok: true,
      json: async () => ({ choices: [{ message: { content } }] }),
    }) as unknown as Response;

  it("prose refusal without JSON surfaces the agent's voice instead of a bare fallback", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    try {
      const prose = "I can't help with that — I only handle software engineering tasks like PR reviews and scans.";
      const out = await parseFreeText("how do I enlarge my dick", {
        fetchImpl: (async () => jsonResponse(prose)) as unknown as typeof fetch,
      });
      expect(out.tool).toBeNull();
      expect(out.reply).toBe(prose);
    } finally {
      delete process.env.OPENROUTER_API_KEY;
    }
  });

  it("provider failure yields no reply so the chat layer applies the canned redirect", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    try {
      const out = await parseFreeText("hello", {
        fetchImpl: (async () => ({ ok: false, json: async () => null }) as unknown as Response) as unknown as typeof fetch,
      });
      expect(out.tool).toBeNull();
      expect(out.reply).toBeUndefined();
    } finally {
      delete process.env.OPENROUTER_API_KEY;
    }
  });
});
