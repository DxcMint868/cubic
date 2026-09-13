// plan-16 — POST /api/demo/chat + GET bootstrap (chat transport).
//
// POST accepts {message, template_id?, task_id?, agent_key?}. Template ids
// resolve to EXACT {tool, arguments} with no LLM (a template's pinned
// agent_key wins); free text goes through the OpenRouter parser (near-miss
// drafts default to the demo repo so they reach the gateway; true small-talk
// or failures → {tool: null} → display-only no-tool state, gateway never
// called). agent_key speaks as another demo agent; a pinned task from a
// different agent's session mints fresh instead of merging. Returns {intent,
// decision, trace_url, network_url} in the standard envelope. GET returns the
// template catalog (with owning agent_key) + demo agents + provider status +
// tools chip count (single source of truth for the chat page).
import { z } from "zod";
import { CHAT_TEMPLATES, listDemoAgents, mcpToolCount, runChatTurn } from "@/server/demo/chat";
import { chatModel, parseProviderConfigured } from "@/server/demo/parse";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  message: z.string().min(1).max(2000).optional(),
  template_id: z.string().min(1).max(64).optional(),
  task_id: z.string().uuid().optional(),
  agent_key: z.string().min(1).max(64).optional(),
});

function baseUrlOf(request: Request): string {
  return new URL(request.url).origin;
}

export async function GET(request: Request) {
  try {
    const tools = await mcpToolCount(baseUrlOf(request)).catch(() => null);
    return Response.json({
      ok: true,
      data: {
        templates: CHAT_TEMPLATES.map((t) => ({ id: t.id, label: t.label, chat_text: t.chat_text, agent_key: t.agent_key ?? "agent:8472" })),
        agents: await listDemoAgents(),
        provider: { configured: parseProviderConfigured(), model: chatModel() },
        tools: { connected: tools },
        client_label: "Demo agent (MCP client)",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: { code: "INTERNAL", message } }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { ok: false, error: { code: "INVALID_REQUEST", message: "invalid JSON body" } },
        { status: 400 },
      );
    }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: { code: "INVALID_REQUEST", message: "body must be {message?, template_id?, task_id?, agent_key?}" } },
        { status: 400 },
      );
    }
    if (!parsed.data.template_id && !parsed.data.message?.trim()) {
      return Response.json(
        { ok: false, error: { code: "INVALID_REQUEST", message: "chat requires template_id or a non-empty message" } },
        { status: 400 },
      );
    }
    const turn = await runChatTurn(
      {
        ...(parsed.data.message?.trim() ? { message: parsed.data.message } : {}),
        ...(parsed.data.template_id ? { template_id: parsed.data.template_id } : {}),
        ...(parsed.data.task_id ? { task_id: parsed.data.task_id } : {}),
        ...(parsed.data.agent_key ? { agent_key: parsed.data.agent_key } : {}),
      },
      baseUrlOf(request),
    );
    return Response.json({
      ok: true,
      data: {
        intent: turn.intent,
        decision: turn.decision,
        trace_url: turn.trace_url,
        network_url: turn.network_url,
        turn,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const badRequest = message.startsWith("unknown template:") || message.startsWith("unknown agent:");
    const status = badRequest ? 400 : 500;
    return Response.json(
      { ok: false, error: { code: status === 400 ? "INVALID_REQUEST" : "INTERNAL", message } },
      { status },
    );
  }
}
