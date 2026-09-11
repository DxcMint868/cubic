import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "@/server/mcp/server";

export const dynamic = "force-dynamic";

// plan-04 EXACT / plan-00 §G — streamable-HTTP MCP facade, no custom auth.
// SDK 1.30's StreamableHTTPServerTransport delegates to this web-standard
// transport; a Next.js route handler speaks native Request/Response, so the
// web-standard class is used directly. Stateless mode: fresh transport +
// McpServer per request (the transport rejects a second request on the same
// instance when sessionIdGenerator is undefined).
export async function POST(request: Request): Promise<Response> {
  const agentKey = request.headers.get("x-cubic-agent");
  if (!agentKey) {
    return Response.json(
      { ok: false, error: { code: "INVALID_REQUEST", message: "missing x-cubic-agent header" } },
      { status: 400 },
    );
  }
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = createMcpServer(agentKey);
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await transport.close();
  }
}

export async function GET(): Promise<Response> {
  return Response.json(
    { ok: false, error: { code: "INVALID_REQUEST", message: "method not allowed" } },
    { status: 405 },
  );
}

export async function DELETE(): Promise<Response> {
  return Response.json(
    { ok: false, error: { code: "INVALID_REQUEST", message: "method not allowed" } },
    { status: 405 },
  );
}
