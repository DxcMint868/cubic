// plan-16 — POST /api/demo/chat + GET bootstrap (chat transport).
//
// POST accepts {message, template_id?, task_id?}. Template ids resolve to
// EXACT {tool, arguments} with no LLM; free text goes through the OpenRouter
// parser (any failure → {tool: null} → display-only no-tool state, gateway
// never called). Returns {intent, decision, trace_url, network_url} in the
// standard envelope. GET returns the template catalog + provider status +
// tools chip count (single source of truth for the chat page).
import { z } from "zod";
import { CHAT_TEMPLATES, mcpToolCount, runChatTurn } from "@/server/demo/chat";
import { chatModel, parseProviderConfigured } from "@/server/demo/parse";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  message: z.string().min(1).max(2000).optional(),
  template_id: z.string().min(1).max(64).optional(),
  task_id: z.string().uuid().optional(),
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
        templates: CHAT_TEMPLATES.map((t) => ({ id: t.id, label: t.label, chat_text: t.chat_text })),
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
        { ok: false, error: { code: "INVALID_REQUEST", message: "body must be {message?, template_id?, task_id?}" } },
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
    const status = message.startsWith("unknown template:") ? 400 : 500;
    return Response.json(
      { ok: false, error: { code: status === 400 ? "INVALID_REQUEST" : "INTERNAL", message } },
      { status },
    );
  }
}
