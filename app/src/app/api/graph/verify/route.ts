// Live subgraph verification page: GET /api/graph/verify?identity=<erc8004>.
// Browsers get a monochrome page showing the EXACT GraphQL query and The
// Graph's raw response (stamped SUBGRAPH DATA) — the "don't take our word"
// surface for reputation. API clients (Accept: json / tests) get the JSON
// envelope with the same payload. Explorer + docs linked for the skeptic;
// the explorer ignores deep-linked queries (verified live), so the query is
// shown here and copyable.
import { AGENT0_QUERY, endpointCandidates } from "@/server/graph/agent0";

export const dynamic = "force-dynamic";

const GRAPHQL_TIMEOUT_MS = 8_000;

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const EXPLORER_URL =
  "https://thegraph.com/explorer/subgraphs/4yYAvQLFjBhBtdRCY7eUWo181VNoTSLLFd5M7FXQAi6u?view=Query&chain=arbitrum-one";
const DOCS_URL = "https://thegraph.com/docs/en/subgraphs/existing-subgraphs/agent0/";

function renderPage(identity: string, queryText: string, result: unknown, fetchedAt: string, sourceHost: string): string {
  const resultJson = JSON.stringify(result, null, 2);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Subgraph data — ${esc(identity)}</title></head>
<body style="background:#000;color:#c9c9c9;font-family:ui-monospace,Menlo,Consolas,monospace;margin:0;padding:32px 20px">
<div style="max-width:820px;margin:0 auto">
<p style="font-size:11px;letter-spacing:.2em;color:#5a5a5a">CUBIC — SUBGRAPH DATA (LIVE)</p>
<h1 style="font-size:26px;color:#f4f4f4;margin:12px 0">Agent ${esc(identity)}</h1>
<p style="font-size:12px;color:#8a8a8a">Fetched ${esc(fetchedAt)} from ${esc(sourceHost)} ·
<a href="${EXPLORER_URL}" target="_blank" rel="noreferrer" style="color:#e8e8e8">OPEN SUBGRAPH IN EXPLORER →</a> ·
<a href="${DOCS_URL}" target="_blank" rel="noreferrer" style="color:#e8e8e8">DOCS</a></p>

<p style="font-size:11px;letter-spacing:.16em;color:#5a5a5a;margin-top:24px">QUERY (AS SENT)</p>
<pre style="background:#0b0b0b;border:1px solid #2e2e2e;border-radius:8px;padding:14px;font-size:11.5px;line-height:1.6;color:#c9c9c9;white-space:pre-wrap;word-break:break-word">${esc(queryText)}</pre>

<p style="font-size:11px;letter-spacing:.16em;color:#5a5a5a;margin-top:24px">RESPONSE (RAW, FROM THE GRAPH)</p>
<pre style="background:#0b0b0b;border:1px solid #2e2e2e;border-radius:8px;padding:14px;font-size:11.5px;line-height:1.6;color:#e8e8e8;white-space:pre-wrap;word-break:break-word">${esc(resultJson)}</pre>

<p style="font-size:10px;color:#5a5a5a;margin-top:24px">The response above is verbatim from The Graph's indexed Agent0 subgraph —
the same values the gateway reads when deciding. Copy the query into the
explorer to reproduce it.</p>
</div></body></html>`;
}

export async function GET(request: Request) {
  const identity = new URL(request.url).searchParams.get("identity") ?? "";
  if (!/^[0-9]+:[0-9a-zA-Z:-]+$/.test(identity)) {
    return Response.json(
      { ok: false, error: { code: "INVALID_REQUEST", message: "identity must look like <chainId>:<agentId>" } },
      { status: 400 },
    );
  }
  const urls = endpointCandidates();
  if (urls.length === 0) {
    return Response.json(
      { ok: false, error: { code: "INVALID_REQUEST", message: "no subgraph configured — set AGENT0_SUBGRAPH_URL or THEGRAPH_API_KEY" } },
      { status: 400 },
    );
  }

  // Inline the identity so the page shows the exact query a human can replay.
  const queryText = AGENT0_QUERY.replace("$id: ID!", "").replace("$id", JSON.stringify(identity)).trim();
  let lastError = "unknown";
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: AGENT0_QUERY, variables: { id: identity } }),
        signal: AbortSignal.timeout(GRAPHQL_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`http ${res.status}`);
      const body = (await res.json()) as { data?: { agent?: unknown }; errors?: Array<{ message?: string }> };
      if (body.errors?.length) throw new Error(body.errors[0]?.message ?? "graphql error");
      if (!body.data?.agent) throw new Error(`identity not indexed: ${identity}`);
      const sourceHost = new URL(url).host;
      const accept = request.headers.get("accept") ?? "";
      const payload = {
        ok: true,
        data: { identity, query: queryText, agent: body.data.agent, fetched_at: new Date().toISOString(), source_host: sourceHost },
      };
      if (accept.includes("text/html")) {
        return new Response(renderPage(identity, queryText, body.data.agent, payload.data.fetched_at, sourceHost), {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      return Response.json(payload);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  return Response.json(
    { ok: false, error: { code: "INTERNAL", message: `subgraph lookup failed: ${lastError}` } },
    { status: 502 },
  );
}
