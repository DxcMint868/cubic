// plan-16 EXACT — free-text → {tool, arguments} parser (server/demo/parse.ts).
//
// OpenRouter pinned: OPENROUTER_API_KEY + optional CHAT_MODEL (default
// `openai/gpt-4o-mini`). Strict JSON `{tool, arguments}` zod-validated against
// the 5 MCP tool shapes, 8s timeout; any failure/refusal yields `{tool: null}`
// → display-only no-tool state, gateway never called. The parser NEVER
// authorizes anything — it only drafts a tool call the gateway then evaluates.

import { z } from "zod";

// The 5 MCP tool shapes (gateway tool names — see server/mcp/server.ts).
const toolSchemas: Record<string, z.ZodTypeAny> = {
  "scanner.scan": z.object({ target: z.string().min(1) }).passthrough(),
  "github.get_pull_request": z.object({ repo: z.string().min(1), pr: z.number().int() }).passthrough(),
  "github.read_file": z.object({ repo: z.string().min(1), path: z.string().min(1) }).passthrough(),
  "github.merge_pull_request": z.object({ repo: z.string().min(1), pr: z.number().int() }).passthrough(),
  "task.complete": z.object({}).passthrough(),
};

const parsedShape = z.object({
  tool: z.string(),
  arguments: z.record(z.string(), z.unknown()),
  reply: z.string().max(280).optional(),
});

export interface ParsedIntent {
  tool: string | null;
  arguments: Record<string, unknown>;
  /** Model-drafted chat line shown as the agent's reply (never a factual claim). */
  reply?: string;
}

export function chatModel(): string {
  const m = process.env.CHAT_MODEL;
  return m && m.trim() !== "" ? m.trim() : "openai/gpt-4o-mini";
}

export function parseProviderConfigured(): boolean {
  return (process.env.OPENROUTER_API_KEY ?? "").trim() !== "";
}

// Pure: validate a candidate {tool, arguments} against the 5 MCP shapes.
// Anything else → {tool: null}. Never throws.
export function validateParsed(candidate: unknown): ParsedIntent {
  const parsed = parsedShape.safeParse(candidate);
  if (!parsed.success) return { tool: null, arguments: {} };
  const reply = typeof parsed.data.reply === "string" && parsed.data.reply.trim() !== "" ? parsed.data.reply : undefined;
  const schema = toolSchemas[parsed.data.tool];
  if (!schema) return { tool: null, arguments: {}, ...(reply ? { reply } : {}) };
  const args = schema.safeParse(parsed.data.arguments);
  if (!args.success) return { tool: null, arguments: {}, ...(reply ? { reply } : {}) };
  const out = args.data as Record<string, unknown>;
  // The model must never choose the task row (or smuggle a client
  // reasoning_ref): task routing belongs to the caller, never LLM output.
  delete out.task_id;
  delete out.reasoning_ref;
  return { tool: parsed.data.tool, arguments: out, ...(reply ? { reply } : {}) };
}

const SYSTEM_PROMPT = [
  "You map a demo user's chat message to ONE Cubic gateway tool call.",
  "Reply with STRICT JSON only, no prose: {\"tool\": \"<name>\", \"arguments\": {…}}.",
  "Allowed tools and required arguments:",
  '- "scanner.scan": {"target": "acme/backend#421"}',
  '- "github.get_pull_request": {"repo": "acme/backend", "pr": 421}',
  '- "github.read_file": {"repo": "acme/backend", "path": "README.md"}',
  '- "github.merge_pull_request": {"repo": "acme/backend", "pr": 421}',
  '- "task.complete": {}',
  "If the message matches no tool, or asks for anything else (deleting repos,",
  "reading secrets, spending money, anything off the list above), reply",
  '{"tool": null, "arguments": {}, "reply": "<one short plain sentence saying what you can do instead>"}',
  "Otherwise include a short 'reply' chat line (max 140 chars) narrating the action, e.g.",
  '{"tool": "github.get_pull_request", "arguments": {"repo": "acme/backend", "pr": 421}, "reply": "On it — pulling up PR #421."}.',
].join("\n");

const PARSE_TIMEOUT_MS = 8000;

// Extract the first balanced {...} JSON object from model prose. The pinned
// free model rejects response_format structured-outputs, so the prompt
// demands strict JSON but the parser never trusts the framing.
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1)) as unknown;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function extractReply(candidate: unknown): string | undefined {
  if (candidate !== null && typeof candidate === "object") {
    const reply = (candidate as { reply?: unknown }).reply;
    if (typeof reply === "string" && reply.trim() !== "" && reply.length <= 280) return reply;
  }
  return undefined;
}

export interface ParseDeps {
  fetchImpl?: typeof fetch;
}

// Free-text parse. Provider unset, timeout, refusal, malformed JSON, schema
// mismatch → {tool: null}. Never throws, never touches the gateway.
export async function parseFreeText(message: string, deps: ParseDeps = {}): Promise<ParsedIntent> {
  if (!parseProviderConfigured()) return { tool: null, arguments: {} };
  const fetchImpl = deps.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PARSE_TIMEOUT_MS);
  try {
    const res = await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: chatModel(),
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: message },
        ],
      }),
    });
    if (!res.ok) return { tool: null, arguments: {} };
    const body = (await res.json().catch(() => null)) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    } | null;
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== "string") return { tool: null, arguments: {} };
    const candidate = extractJsonObject(content);
    if (candidate === null) return { tool: null, arguments: {} };
    if (candidate !== null && typeof candidate === "object" && (candidate as { tool?: unknown }).tool === null) {
      const reply = extractReply(candidate);
      return { tool: null, arguments: {}, ...(reply ? { reply } : {}) };
    }
    return validateParsed(candidate);
  } catch {
    return { tool: null, arguments: {} };
  } finally {
    clearTimeout(timer);
  }
}
