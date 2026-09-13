// plan-16 EXACT — free-text → {tool, arguments} parser (server/demo/parse.ts).
//
// OpenRouter pinned: OPENROUTER_API_KEY + optional CHAT_MODEL (default
// `openai/gpt-4o-mini`). Strict JSON `{tool, arguments}` zod-validated: the 5
// MCP tools against their exact shapes, anything else that looks like a
// gateway tool name (`scope.action`) passes through verbatim so the
// deterministic policy engine can ALLOW/DENY/ESCALATE it for real. 8s
// timeout; provider-unset/timeout/refusal/malformed JSON/small-talk yields
// `{tool: null}` → display-only no-tool state, gateway never called.
// The parser NEVER authorizes anything — it only drafts a tool call the
// gateway then evaluates (LLM drafts, policy decides).

import { z } from "zod";

// The 5 MCP tool shapes (gateway tool names — see server/mcp/server.ts).
// Forgiving by design: pr coerces ("12" → 12); the demo repo/target default
// in when the model omits them ("read PR 12" → acme/backend#12) so near-miss
// drafts reach the gateway — which decides — instead of dying in the parser.
const toolSchemas: Record<string, z.ZodTypeAny> = {
  "scanner.scan": z.object({ target: z.string().min(1) }).passthrough(),
  "github.get_pull_request": z.object({ repo: z.string().min(1), pr: z.coerce.number().int() }).passthrough(),
  "github.read_file": z.object({ repo: z.string().min(1), path: z.string().min(1) }).passthrough(),
  "github.merge_pull_request": z.object({ repo: z.string().min(1), pr: z.coerce.number().int() }).passthrough(),
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

// Pure: validate a candidate {tool, arguments}. The 5 MCP shapes are exact;
// any other plausible gateway tool name passes through with generic
// arguments so the policy engine — never the LLM — decides its fate
// (unknown tools deterministically DENY via the tool-allowlist rule).
// Anything without a tool-like name → {tool: null}. Never throws.
export function validateParsed(candidate: unknown): ParsedIntent {
  const parsed = parsedShape.safeParse(candidate);
  if (!parsed.success) return { tool: null, arguments: {} };
  const reply = typeof parsed.data.reply === "string" && parsed.data.reply.trim() !== "" ? parsed.data.reply : undefined;
  const schema = toolSchemas[parsed.data.tool];
  if (schema) {
    // Demo defaults: the model may omit what the user left unsaid.
    const withDefaults = { ...(parsed.data.arguments as Record<string, unknown>) };
    if (parsed.data.tool.startsWith("github.") && withDefaults.repo == null) {
      withDefaults.repo = "acme/backend";
    }
    if (parsed.data.tool === "scanner.scan" && withDefaults.target == null) {
      withDefaults.target = "acme/backend#421";
    }
    const args = schema.safeParse(withDefaults);
    if (!args.success) return { tool: null, arguments: {}, ...(reply ? { reply } : {}) };
    const out = args.data as Record<string, unknown>;
    // The model must never choose the task row (or smuggle a client
    // reasoning_ref): task routing belongs to the caller, never LLM output.
    delete out.task_id;
    delete out.reasoning_ref;
    return { tool: parsed.data.tool, arguments: out, ...(reply ? { reply } : {}) };
  }
  // Passthrough: let the gateway evaluate (and, where policy says so, BLOCK)
  // the LLM-drafted call. Shape is deliberately loose — the normalizer +
  // policy engine are the authority on what is allowed.
  if (/^[a-z0-9_.-]+\.[a-z0-9_.-]+$/i.test(parsed.data.tool) && parsed.data.arguments !== null && typeof parsed.data.arguments === "object" && !Array.isArray(parsed.data.arguments)) {
    const out = { ...(parsed.data.arguments as Record<string, unknown>) };
    delete out.task_id;
    delete out.reasoning_ref;
    return { tool: parsed.data.tool, arguments: out, ...(reply ? { reply } : {}) };
  }
  return { tool: null, arguments: {}, ...(reply ? { reply } : {}) };
}

const BASE_PROMPT_LINES = [
  "You map a demo user's chat message to ONE Cubic gateway tool call.",
  "Reply with STRICT JSON only, no prose: {\"tool\": \"<name>\", \"arguments\": {…}, \"reply\": \"<one short chat line narrating the action>\"}.",
  "Preferred tools and their arguments (omit repo/target when the user did not",
  "name one — they default to the demo repo acme/backend / target acme/backend#421):",
  '- "scanner.scan": {"target": "acme/backend#421"}',
  '- "github.get_pull_request": {"repo": "acme/backend", "pr": 421}',
  '- "github.read_file": {"repo": "acme/backend", "path": "README.md"}',
  '- "github.merge_pull_request": {"repo": "acme/backend", "pr": 421}',
  '- "task.complete": {}',
  "You are the LLM — act like one: always draft the closest tool call for what",
  "the user asked, even when it looks disallowed. Examples:",
  '- "delete the repo" → {"tool": "github.delete_repo", "arguments": {"repo": "acme/backend"}}',
  '- "read the production secrets" → {"tool": "github.read_file", "arguments": {"repo": "acme/backend", "path": ".env.production"}}',
  '- "deploy to production" → {"tool": "deploy.production", "arguments": {"repo": "acme/backend"}}',
  '- "swap/treasury/payroll/stake" → the matching "treasury.*" tool with your best-guess arguments',
  "Never self-censor with {\"tool\": null} for a disallowed action — the",
  "deterministic gateway policy (never you) decides ALLOW / DENY / ESCALATE,",
  "and a gateway DENY is the impressive demo moment.",
  "Only use {\"tool\": null, \"arguments\": {}, \"reply\": \"<what you can do instead>\"}",
  "for true small-talk or when the message maps to no action at all.",
];

// Identity block: the speaking agent's voice (SOUL), knowledge (MEMORY), and
// granted tools. This is what makes "Hi, who are you" answer AS the agent.
// The agent NEVER decides authorization — it only drafts, and speaks.
export function buildSystemPrompt(agent?: ParseDeps["agent"]): string {
  if (!agent) return BASE_PROMPT_LINES.join("\n");
  const lines = [
    `You ARE ${agent.name} (${agent.key}) — answer in the first person, in this voice. Never claim to be a different agent.`,
  ];
  if (agent.soul) lines.push(`SOUL (who you are):\n${agent.soul}`);
  if (agent.memory) lines.push(`MEMORY (what you know):\n${agent.memory}`);
  if (agent.tools && agent.tools.length > 0) {
    lines.push(
      `Your gateway-granted tools: ${agent.tools.join(", ")}. Prefer drafting these; ` +
        "you may still draft any other tool you think fits — the deterministic gateway " +
        "policy decides what you may actually do, never you.",
    );
  }
  lines.push(
    "Your \"reply\" chat line always speaks in this voice. When you return",
    "{\"tool\": null} (small-talk, introductions, out-of-scope chatter), the reply",
    "is your whole answer — make it sound like you, and name 2-3 things you CAN do.",
  );
  return [...lines, "", ...BASE_PROMPT_LINES].join("\n");
}

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
  /** Who is speaking — injected into the system prompt so the model answers
   *  AS this agent (first person, its tools, its voice). */
  agent?: {
    key: string;
    name: string;
    soul?: string | null;
    memory?: string | null;
    tools?: string[];
  };
}

// Free-text parse. Provider unset, timeout, refusal, malformed JSON, or true
// small-talk → {tool: null}. Never throws, never touches the gateway.
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
          { role: "system", content: buildSystemPrompt(deps.agent) },
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
    // No JSON block (typical of safety-style prose refusals, which ignore the
    // strict-JSON instruction): the agent still spoke, so surface its voice
    // verbatim (truncated) instead of falling back to the generic line.
    if (candidate === null) {
      const prose = content.trim().slice(0, 280);
      return { tool: null, arguments: {}, ...(prose ? { reply: prose } : {}) };
    }
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
