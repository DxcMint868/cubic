import { runToolCall } from "@/server/gateway/orchestrator";
import type { ApiErrorCode, ToolCall } from "@/server/domain";

export const dynamic = "force-dynamic";

const HTTP_STATUS: Record<ApiErrorCode, number> = {
  INVALID_REQUEST: 400,
  AGENT_NOT_FOUND: 404,
  TASK_NOT_FOUND: 404,
  TOOL_NOT_FOUND: 404,
  CAPABILITY_REJECTED: 403,
  PAYMENT_REQUIRED: 402,
  INTERNAL: 500,
};

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
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return Response.json(
        { ok: false, error: { code: "INVALID_REQUEST", message: "body must be a JSON object" } },
        { status: 400 },
      );
    }

    const input: Record<string, unknown> = { ...(body as Record<string, unknown>) };
    const agentHeader = request.headers.get("x-cubic-agent");
    if (agentHeader) input.agent_key = agentHeader;
    if (input.task_id == null) {
      const taskHeader = request.headers.get("x-cubic-task");
      if (taskHeader) input.task_id = taskHeader;
    }

    const result = await runToolCall(input as unknown as ToolCall);
    if (result.ok) return Response.json({ ok: true, data: result.data });
    return Response.json(
      { ok: false, error: result.error },
      { status: HTTP_STATUS[result.error.code] ?? 500 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      { ok: false, error: { code: "INTERNAL", message } },
      { status: 500 },
    );
  }
}
