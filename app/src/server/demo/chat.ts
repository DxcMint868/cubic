// plan-16 — demo chat turn runner (server/demo/chat.ts).
//
// POST /api/demo/chat accepts {message, template_id?, task_id?}. Template ids
// resolve to EXACT {tool, arguments} with no LLM. Free text goes through
// parse.ts (OpenRouter pinned; any failure → {tool: null} → display-only
// no-tool state, gateway never called). Origin stays "agent".
//
// Execution goes through the identical orchestrator two ways: tools backed by
// the 5 MCP tools run through a fresh-per-call MCP SDK Client (streamable
// HTTP, x-cubic-agent header) against our own /api/mcp; anything else
// (deploy.production, treasury.*, unknown tools) runs runToolCall in-process.
// Both funnel into runToolCall, so audit chains are transport-independent.

import { createHash } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { config } from "../config";
import { db } from "../db/client";
import { agents, auditEvents, decisions, intents, policies, tasks, tenants, tools } from "../db/schema";
import type { NormalizedIntent } from "../domain";
import { runToolCall, type ToolCallData } from "../gateway/orchestrator";
import { consumeCapability } from "../capability/verify";
import type { Rule } from "../gateway/policy/engine";
import { CHAT_TEMPLATES, getTemplate, type ChatTemplate } from "./templates";
import { chatModel, parseFreeText, parseProviderConfigured } from "./parse";
import { ANCHORED_TYPES, anchorTopicId, fingerprint, topicUrl } from "../anchors/hcs";

export { CHAT_TEMPLATES };

const AGENT_KEY = "agent:8472";
const DEMO_CLIENT_LABEL = "Demo agent (MCP client)";

export const NO_TOOL_MESSAGE = "No tool matched — nothing was sent to the gateway";

// Gateway tools backed by the MCP facade (sdk names in server/mcp/server.ts).
const MCP_GATEWAY_TO_SDK: Record<string, string> = {
  "scanner.scan": "scanner_scan",
  "github.get_pull_request": "github_get_pull_request",
  "github.read_file": "github_read_file",
  "github.merge_pull_request": "github_merge_pull_request",
  "task.complete": "task_complete",
};

const TREASURY_TOOLS = [
  { name: "treasury.swap", category: "treasury", defaultRiskClass: "high", executor: "treasury", executorConfig: {} },
  { name: "treasury.transfer", category: "treasury", defaultRiskClass: "high", executor: "treasury", executorConfig: {} },
  { name: "treasury.stake", category: "treasury", defaultRiskClass: "medium", executor: "treasury", executorConfig: {} },
];

export interface ChatTurn {
  kind: "tool" | "no-tool" | "lifecycle";
  template_id: string | null;
  chat_text: string;
  client_label: string;
  /** The agent's conversational opening line (canned or model-drafted). */
  reply: string | null;
  task_id: string | null;
  tool: string | null;
  arguments: Record<string, unknown>;
  transport: "mcp" | "gateway" | null;
  intent: NormalizedIntent | null;
  decision: ToolCallData["decision"] | null;
  matched_policy: string | null;
  matched_rule_id: string | null;
  reasons: Array<{ code: string; detail?: string }>;
  risk_score: number | null;
  approval: { id: string; provider: string; status: string } | null;
  approval_outcome: "approved" | "rejected" | null;
  capability: ToolCallData["capability"];
  execution: ToolCallData["execution"];
  payment: ToolCallData["payment"];
  payment_required: ToolCallData["payment_required"];
  lines: { capability?: string; execution?: string; payment?: string };
  receipt: { amount_usd_cents: number; network: "hedera"; ref: string; ref_kind: "settlement" | "challenge" } | null;
  rejections: Array<{ step: string; reason: string; capability_id: string }>;
  // HCS anchors for THIS turn's chain (fence-clean UI surface for the plan's
  // "UI renders fingerprint + topic-explorer link" clause — computed server-
  // side so the client never imports node:crypto).
  anchors: Array<{ event_type: string; fingerprint: string; topic_id: string | null; topic_url: string | null }>;
  trace_url: string | null;
  network_url: string;
  provider: { configured: boolean; model: string };
  tools: { connected: number | null };
  no_tool_message: string | null;
}

// -- MCP client ---------------------------------------------------------------

let mcpToolsCache = new Map<string, string[]>();

export function clearMcpCacheForTests(): void {
  mcpToolsCache = new Map();
}

function mcpUrl(baseUrl: string): URL {
  return new URL("/api/mcp", baseUrl);
}

async function listMcpTools(baseUrl: string): Promise<string[]> {
  const cached = mcpToolsCache.get(baseUrl);
  if (cached) return cached;
  const client = new Client({ name: "cubic-demo-chat", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(mcpUrl(baseUrl), {
    requestInit: { headers: { "x-cubic-agent": AGENT_KEY } },
  });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const names = listed.tools.map((t) => t.name);
    mcpToolsCache.set(baseUrl, names);
    return names;
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function mcpToolCount(baseUrl: string): Promise<number | null> {
  try {
    return (await listMcpTools(baseUrl)).length;
  } catch {
    return null;
  }
}

interface McpCallResult {
  ok: true;
  data: ToolCallData;
}

async function callViaMcp(
  baseUrl: string,
  sdkTool: string,
  args: Record<string, unknown>,
  agentKey: string,
): Promise<McpCallResult> {
  const client = new Client({ name: "cubic-demo-chat", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(mcpUrl(baseUrl), {
    requestInit: { headers: { "x-cubic-agent": agentKey } },
  });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: sdkTool, arguments: args });
    const content = ((result as unknown as { content?: Array<{ type: string; text?: string }> }).content ?? [])
      .filter((c) => c.type === "text" && typeof c.text === "string")
      .map((c) => c.text as string)
      .join("");
    if (!content) throw new Error(`MCP tool ${sdkTool} returned no text content`);
  const body = JSON.parse(content) as { ok?: boolean; error?: { message?: string } };
    // The MCP facade returns the raw tool-call data JSON on success (no `ok`
    // wrapper) and {ok: false, error} on isError — distinguish explicitly.
    if (body.ok === false) {
      throw new Error(`gateway rejected ${sdkTool}: ${body.error?.message ?? "unknown error"}`);
    }
    return { ok: true, data: body as unknown as ToolCallData };
  } finally {
    await client.close().catch(() => undefined);
  }
}

// -- Fixtures -----------------------------------------------------------------

async function resolveTenant(): Promise<{ id: string }> {
  const [tenant] = await db().select().from(tenants).where(eq(tenants.slug, config().DEMO_TENANT_SLUG));
  if (!tenant) throw new Error(`demo chat: tenant missing (${config().DEMO_TENANT_SLUG})`);
  return { id: tenant.id };
}

// Treasury tool rows + allowlist graft (idempotent). Mirrors the plan-11
// treasury script's graft; demo-surface data setup, not an engine change.
async function ensureTreasuryFixtures(tenantId: string, agentKey: string): Promise<void> {
  await db()
    .insert(tools)
    .values(
      TREASURY_TOOLS.map((t) => ({ tenantId, ...t })),
    )
    .onConflictDoNothing({ target: [tools.tenantId, tools.name] });
  const [policy] = await db()
    .select()
    .from(policies)
    .where(and(eq(policies.tenantId, tenantId), eq(policies.name, "default-v1")))
    .orderBy(desc(policies.version))
    .limit(1);
  if (!policy) throw new Error("demo chat: default-v1 missing");  const rules = [...(policy.rules as Rule[])];
  const at = rules.findIndex((r) => r.id === "tool-allowlist");
  if (at < 0) throw new Error("demo chat: tool-allowlist rule missing in default-v1");
  const names = TREASURY_TOOLS.map((t) => t.name);
  if (!names.every((n) => rules[at].tools?.includes(n))) {
    rules[at] = { ...rules[at], tools: [...(rules[at].tools ?? []), ...names.filter((n) => !rules[at].tools?.includes(n))] };
    await db().update(policies).set({ rules }).where(eq(policies.id, policy.id));
  }
  // Per-agent grants are enforced (see orchestrator agent-grant check), so the
  // acting agent needs the treasury tools granted too — mirrors treasury.ts.
  const [actingAgent] = await db()
    .select()
    .from(agents)
    .where(and(eq(agents.tenantId, tenantId), eq(agents.agentKey, agentKey)));
  if (actingAgent) {
    const have = (actingAgent.declaredCapabilities ?? []) as string[];
    const missing = names.filter((n) => !have.includes(n));
    if (missing.length) {
      await db().update(agents).set({ declaredCapabilities: [...have, ...missing] }).where(eq(agents.id, actingAgent.id));
    }
  }
}

// -- Turn assembly --------------------------------------------------------------

function shortRef(value: string): string {
  return value.slice(0, 8);
}

// Per-turn HCS anchors: allowlisted audit events belonging to this turn's
// chain (matched by intent/decision/capability/approval/execution/payment
// id), each with the display-identical fingerprint + real-or-absent topic link.
async function turnAnchors(
  taskId: string | null,
  data: ToolCallData,
): Promise<ChatTurn["anchors"]> {
  if (!taskId) return [];
  const ids = new Set<string>([data.intent_id]);
  const [decRow] = await db().select().from(decisions).where(eq(decisions.intentId, data.intent_id));
  if (decRow) ids.add(decRow.id);
  if (data.approval_id) ids.add(data.approval_id);
  if (data.capability) ids.add(data.capability.capability_id);
  if (data.execution) ids.add(data.execution.execution_id);
  if (data.payment) ids.add(data.payment.payment_id);
  const rows = await db()
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.taskId, taskId))
    .orderBy(asc(auditEvents.id));
  const topic_id = anchorTopicId();
  const out: ChatTurn["anchors"] = [];
  for (const row of rows) {
    if (!ANCHORED_TYPES.has(row.eventType)) continue;
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    const related = ["intent_id", "decision_id", "capability_id", "approval_id", "execution_id", "payment_id"].some(
      (key) => typeof payload[key] === "string" && ids.has(payload[key] as string),
    );
    if (!related) continue;
    out.push({
      event_type: row.eventType,
      fingerprint: fingerprint({ event_type: row.eventType, payload }),
      topic_id,
      topic_url: topic_id ? topicUrl(topic_id) : null,
    });
  }
  return out;
}

function buildTurn(base: Partial<ChatTurn> & { chat_text: string; task_id: string | null }): ChatTurn {
  return {
    kind: "tool",
    template_id: null,
    client_label: DEMO_CLIENT_LABEL,
    reply: null,
    tool: null,
    arguments: {},
    transport: null,
    intent: null,
    decision: null,
    matched_policy: null,
    matched_rule_id: null,
    reasons: [],
    risk_score: null,
    approval: null,
    approval_outcome: null,
    capability: null,
    execution: null,
    payment: null,
    payment_required: null,
    lines: {},
    receipt: null,
    rejections: [],
    anchors: [],
    trace_url: null,
    network_url: "/network",
    provider: { configured: parseProviderConfigured(), model: chatModel() },
    tools: { connected: null },
    no_tool_message: null,
    ...base,
  };
}

async function hydrateTurn(
  partial: Partial<ChatTurn> & { chat_text: string },
  data: ToolCallData,
  transport: "mcp" | "gateway",
  toolsConnected: number | null,
): Promise<ChatTurn> {
  const [intentRow] = await db().select().from(intents).where(eq(intents.id, data.intent_id));
  const intent = (intentRow?.normalized ?? null) as NormalizedIntent | null;
  const taskId = intentRow?.taskId ?? null;

  let approval: ChatTurn["approval"] = null;
  if (data.approval_id) {
    const { approvals } = await import("../db/schema");
    const [row] = await db().select().from(approvals).where(eq(approvals.id, data.approval_id));
    approval = row ? { id: row.id, provider: row.provider, status: row.status } : null;
  }

  const lines: ChatTurn["lines"] = {};
  if (data.capability) {
    lines.capability = `capability ${shortRef(data.capability.nonce)} · ${data.capability.action} · expires ${data.capability.expires_at}`;
  }
  if (data.execution) {
    lines.execution = data.execution.result_summary ?? `execution ${data.execution.status}`;
  }

  // Amount comes from the payments row (the DB is the source of truth).
  let paidCents: number | null = null;
  if (data.payment) {
    const schema = await import("../db/schema");
    const [paymentRow] = await db()
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, data.payment.payment_id));
    paidCents = paymentRow?.amountUsdCents ?? null;
  }
  if (data.payment?.status === "completed") {
    const amount = paidCents != null ? `$${(paidCents / 100).toFixed(2)}` : "settled";
    lines.payment = `${amount} · hedera · ${shortRef(data.payment.settlement_ref ?? "")}`;
  } else if (data.payment?.status === "failed") {
    lines.payment = `payment failed · ${data.payment.error_code ?? "unknown"}`;
  } else if (data.payment_required) {
    lines.payment = `payment required $${(data.payment_required.price_usd_cents / 100).toFixed(2)} · hedera`;
  }

  // Scan receipt: amount + hedera + short ref. Settlement ref when the payment
  // completed; otherwise the challenge short-hash (labeled as such — a
  // discovery turn never claims a settlement).
  let receipt: ChatTurn["receipt"] = null;
  if (data.payment?.status === "completed" && data.payment.settlement_ref) {
    receipt = {
      amount_usd_cents: paidCents ?? 0,
      network: "hedera",
      ref: shortRef(data.payment.settlement_ref),
      ref_kind: "settlement",
    };
  } else if (data.payment_required) {
    receipt = {
      amount_usd_cents: data.payment_required.price_usd_cents,
      network: "hedera",
      ref: shortRef(createHash("sha256").update(JSON.stringify(data.payment_required.challenge)).digest("hex")),
      ref_kind: "challenge",
    };
  }

  return buildTurn({
    ...partial,
    task_id: taskId,
    transport,
    intent,
    decision: data.decision,
    matched_policy: data.matched_policy,
    matched_rule_id: data.matched_rule_id,
    reasons: data.reasons,
    risk_score: data.risk_score,
    approval,
    capability: data.capability,
    execution: data.execution,
    payment: data.payment,
    payment_required: data.payment_required,
    lines,
    receipt,
    anchors: await turnAnchors(taskId, data),
    trace_url: taskId ? `/console/tasks/${taskId}` : null,
    tools: { connected: toolsConnected },
  });
}

// -- Entry point ------------------------------------------------------------------

export interface ChatInput {
  message?: string;
  template_id?: string;
  task_id?: string;
}

export async function runChatTurn(input: ChatInput, baseUrl: string): Promise<ChatTurn> {
  const tenant = await resolveTenant();
  const toolsConnected = await mcpToolCount(baseUrl).catch(() => null);

  let template: ChatTemplate | null = null;
  let chatText = "";
  let tool: string | null = null;
  let args: Record<string, unknown> = {};
  let kind: ChatTurn["kind"] = "tool";
  let reply: string | null = null;

  if (input.template_id) {
    template = getTemplate(input.template_id);
    if (!template) throw new Error(`unknown template: ${input.template_id}`);
    chatText = template.chat_text;
    kind = template.kind;
    tool = template.tool;
    args = { ...template.arguments };
    reply = template.reply ?? null;
  } else if (typeof input.message === "string" && input.message.trim() !== "") {
    chatText = input.message;
    const parsed = await parseFreeText(input.message);
    tool = parsed.tool;
    args = parsed.arguments;
    reply = parsed.reply ?? null;
    kind = tool ? "tool" : "no-tool";
  } else {
    throw new Error("chat requires template_id or a non-empty message");
  }

  // Display-only no-tool state: plain words, gateway never called. trace_url
  // stays null unconditionally — a turn with zero gateway rows must never
  // link to a trace full of other turns' Decisions.
  if (kind === "no-tool" || tool === null) {
    return buildTurn({
      kind: "no-tool",
      template_id: template?.id ?? null,
      chat_text: chatText,
      reply,
      task_id: input.task_id ?? null,
      tool: null,
      arguments: {},
      trace_url: null,
      tools: { connected: toolsConnected },
      no_tool_message: NO_TOOL_MESSAGE,
    });
  }

  // Fresh task when the template demands one (e.g. the over-budget beat) —
  // template.spec always wins so the beat's budget is exact. Otherwise every
  // chat turn lands in its own session task, so chat sessions show up in
  // /console/tasks instead of piggybacking the agent's latest open task.
  let taskId = input.task_id ?? null;
  const agentKey = template?.agent_key ?? AGENT_KEY;
  const [actor] = await db()
    .select()
    .from(agents)
    .where(and(eq(agents.tenantId, tenant.id), eq(agents.agentKey, agentKey)));
  if (!actor) throw new Error(`demo chat: ${agentKey} missing`);
  if (template?.task) {
    const [task] = await db()
      .insert(tasks)
      .values({
        tenantId: tenant.id,
        agentId: actor.id,
        title: template.task.title,
        budgetUsdCents: template.task.budget_usd_cents,
        status: "open",
      })
      .returning();
    taskId = task.id;
  } else if (!taskId) {
    const [task] = await db()
      .insert(tasks)
      .values({
        tenantId: tenant.id,
        agentId: actor.id,
        title: `Chat: ${chatText.slice(0, 80)}`,
        budgetUsdCents: 50,
        status: "open",
      })
      .returning();
    taskId = task.id;
  }

  if (tool.startsWith("treasury.")) {
    await ensureTreasuryFixtures(tenant.id, agentKey);
  }

  // Lifecycle scripts run the underlying call, then the scripted step through
  // the real machinery (resolve route / consume path).
  if (template?.lifecycle === "drain-reject") {
    return runDrainReject({ chatText, template, tool, args, taskId, baseUrl, toolsConnected, agentKey });
  }
  if (template?.lifecycle === "replay" || template?.lifecycle === "expired") {
    return runCapabilityLifecycle({
      chatText,
      template,
      tool,
      args,
      taskId,
      baseUrl,
      toolsConnected,
      mode: template.lifecycle,
      agentKey,
    });
  }

  const data = await executeCall({ tool, args, taskId, baseUrl, agentKey });
  return hydrateTurn(
    { template_id: template?.id ?? null, chat_text: chatText, reply, task_id: taskId, tool, arguments: args },
    data.data,
    data.transport,
    toolsConnected,
  );
}

async function executeCall(input: {
  tool: string;
  args: Record<string, unknown>;
  taskId: string | null;
  baseUrl: string;
  agentKey: string;
}): Promise<{ data: ToolCallData; transport: "mcp" | "gateway" }> {
  const sdkTool = MCP_GATEWAY_TO_SDK[input.tool];
  if (sdkTool) {
    const callArgs = { ...input.args };
    if (input.taskId) callArgs.task_id = input.taskId;
    const result = await callViaMcp(input.baseUrl, sdkTool, callArgs, input.agentKey);
    return { data: result.data, transport: "mcp" };
  }
  const result = await runToolCall({
    ...(input.taskId ? { task_id: input.taskId } : {}),
    agent_key: input.agentKey,
    tool: input.tool,
    arguments: input.args,
  });
  if (!result.ok) throw new Error(`gateway rejected ${input.tool}: ${result.error.message}`);
  return { data: result.data, transport: "gateway" };
}

// $450k drain: escalate through the real pipeline, then the approver rejects
// through the real resolve route — no capability, no execution, the rejection
// on the record.
async function runDrainReject(input: {
  chatText: string;
  template: ChatTemplate;
  tool: string;
  args: Record<string, unknown>;
  taskId: string | null;
  baseUrl: string;
  toolsConnected: number | null;
  agentKey: string;
}): Promise<ChatTurn> {
  const executed = await executeCall({ tool: input.tool, args: input.args, taskId: input.taskId, baseUrl: input.baseUrl, agentKey: input.agentKey });
  if (executed.data.decision !== "escalate" || !executed.data.approval_id) {
    throw new Error(`drain setup: expected escalate + approval, got ${executed.data.decision}`);
  }
  const { POST: resolvePOST } = await import("../../app/api/approvals/[id]/resolve/route");
  const res = await resolvePOST(
    new Request("http://chat.local/api/approvals/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outcome: "rejected", resolved_by: "demo-operator" }),
    }),
    { params: Promise.resolve({ id: executed.data.approval_id }) },
  );
  const body = (await res.json()) as { ok: boolean; data?: { approval_outcome: string } };
  if (!body.ok || body.data?.approval_outcome !== "rejected") {
    throw new Error(`drain reject failed: ${JSON.stringify(body)}`);
  }
  const turn = await hydrateTurn(
    {
      kind: "lifecycle",
      template_id: input.template.id,
      chat_text: input.chatText,
      reply: input.template.reply ?? null,
      task_id: input.taskId,
      tool: input.tool,
      arguments: input.args,
    },
    executed.data,
    executed.transport,
    input.toolsConnected,
  );
  turn.approval_outcome = "rejected";
  if (turn.approval) turn.approval.status = "rejected";
  turn.lines.execution = "no capability, no execution — the approver rejected it";
  return turn;
}

// Replay / expired: an allowed call issues a real capability — the pipeline
// consumes it on the allow path — then the scripted step drives it through
// the real consume path again: replay mode expects rejected/replay outright;
// expired mode backdates the row first and expects rejected/expired (the
// expiry check runs before the status check in the real verify code).
async function runCapabilityLifecycle(input: {
  chatText: string;
  template: ChatTemplate;
  tool: string;
  args: Record<string, unknown>;
  taskId: string | null;
  baseUrl: string;
  toolsConnected: number | null;
  mode: "replay" | "expired";
  agentKey: string;
}): Promise<ChatTurn> {
  const executed = await executeCall({ tool: input.tool, args: input.args, taskId: input.taskId, baseUrl: input.baseUrl, agentKey: input.agentKey });
  if (!executed.data.capability) throw new Error(`${input.mode} setup: expected a capability`);
  const cap = executed.data.capability;
  if (input.mode === "expired") {
    const { capabilities } = await import("../db/schema");
    await db()
      .update(capabilities)
      .set({ expiresAt: new Date(Date.now() - 60_000).toISOString() })
      .where(eq(capabilities.id, cap.capability_id));
  }
  const second = await consumeCapability(cap.capability_id, { action: cap.action, resource: cap.resource });
  if (second.status !== "rejected" || second.reason !== input.mode) {
    throw new Error(`expected rejected/${input.mode}, got ${JSON.stringify(second)}`);
  }
  const turn = await hydrateTurn(
    {
      kind: "lifecycle",
      template_id: input.template.id,
      chat_text: input.chatText,
      reply: input.template.reply ?? null,
      task_id: input.taskId,
      tool: input.tool,
      arguments: input.args,
    },
    executed.data,
    executed.transport,
    input.toolsConnected,
  );
  turn.rejections = [{ step: input.mode, reason: second.reason, capability_id: cap.capability_id }];
  turn.lines.execution = `capability ${input.mode === "replay" ? "replayed" : "expired"} → rejected (${second.reason})`;
  return turn;
}
