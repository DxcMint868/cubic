// plan-11 step 2 — LangSmith reasoning links (AgentGate's `reasoning_ref` shape).
//
// Contract: links are real or absent — never mocked, never fabricated. A
// `reasoning_ref` is returned only when a LangSmith run id came out of the
// SDK *and* that run reads back from the API (invalid keys fail the POST
// silently inside the SDK, so the read-back is what makes the link honest).
// No key, any throw, any timeout → the base intent untouched (`null` path).

import type { NormalizedIntent } from "../domain";

export interface ReasoningRef {
  run_id: string;
  share_url: string | null;
  model?: string;
}

// Client passthrough validation: `ToolCall.arguments.reasoning_ref`.
// Malformed → null (dropped, never throws). `run_id` must be a uuid (the only
// shape the SDK ever mints — anything else is fabricated); `share_url` must
// be a non-empty https URL (never rendered otherwise — no phish, no dead
// empty-href links); `model` is capped. Absent/undefined `share_url`
// normalizes to null so the persisted shape always matches the contract.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function extractReasoningRef(args: Record<string, unknown>): ReasoningRef | null {
  const raw = args.reasoning_ref;
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const { run_id, share_url, model } = raw as Record<string, unknown>;
  if (typeof run_id !== "string" || !UUID_RE.test(run_id)) return null;
  if (share_url !== null && share_url !== undefined) {
    if (typeof share_url !== "string" || share_url.length === 0 || !share_url.startsWith("https://")) {
      return null;
    }
  }
  if (model !== undefined && (typeof model !== "string" || model.length === 0 || model.length > 120)) {
    return null;
  }
  const ref: ReasoningRef = {
    run_id,
    share_url: typeof share_url === "string" ? share_url : null,
  };
  if (typeof model === "string") ref.model = model;
  return ref;
}

export function langsmithProject(): string {
  const name = process.env.LANGSMITH_PROJECT;
  return name && name.length > 0 ? name : "cubic-demo";
}

// Bounds the whole LangSmith attempt so a hanging API can never stall the
// gateway — the deterministic rules path is the fallback, always. The SDK's
// own 90s default timeout is far too long for the hot path, so every client
// here is constructed with SDK_TIMEOUT_MS; the outer race timer is cleared
// on settle so assisted calls leave no dangling timers.
const TRACE_TIMEOUT_MS = 8000;
const SDK_TIMEOUT_MS = 5000;

export async function traceAssistedNormalize(
  input: { tool: string; args: Record<string, unknown>; taskId: string },
  base: NormalizedIntent,
): Promise<NormalizedIntent> {
  const apiKey = process.env.LANGSMITH_API_KEY;
  if (!apiKey) return base;
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const bounded = new Promise<NormalizedIntent>((_, reject) => {
      timer = setTimeout(() => reject(new Error("langsmith timeout")), TRACE_TIMEOUT_MS);
    });
    return await Promise.race([attemptTrace(apiKey, input, base), bounded]);
  } catch {
    return base;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function attemptTrace(
  apiKey: string,
  input: { tool: string; args: Record<string, unknown>; taskId: string },
  base: NormalizedIntent,
): Promise<NormalizedIntent> {
  const { traceable, getCurrentRunTree } = await import("langsmith/traceable");
  const { Client } = await import("langsmith");

  let runId: string | null = null;
  const classify = traceable(
    async (snapshot: { tool: string; action: string; resource: string; risk_class: string }) => {
      // Captured inside the traced function, where the run tree is current.
      // (Called outside, getCurrentRunTree() throws — no absent-tree default.)
      runId = getCurrentRunTree().id;
      // The deterministic rules already produced `base`; the traced run
      // records this normalization (inputs → outputs) in LangSmith. No LLM
      // call is fabricated here — the run metadata is exactly what ran.
      return { action: snapshot.action, resource: snapshot.resource, risk_class: snapshot.risk_class };
    },
    { name: "cubic.intent.normalize", project_name: langsmithProject() },
  );
  await classify({
    tool: input.tool,
    action: base.action,
    resource: base.resource,
    risk_class: base.risk_class,
  });
  if (!runId) return base;

  const client = new Client({ apiKey, timeout_ms: SDK_TIMEOUT_MS });
  // Honesty gate: the SDK swallows POST failures (console.error only), so a
  // captured id proves nothing by itself. Read the run back — a missing run
  // (bad key, tracing disabled, post failed) throws → null path, no dead link.
  try {
    await client.readRun(runId);
  } catch {
    return base;
  }

  let shareUrl: string | null = null;
  try {
    // shareRun resolves to the complete public URL (host-aware — respects
    // LANGSMITH_ENDPOINT). Used verbatim: never templated, never fabricated.
    const url = await client.shareRun(runId);
    shareUrl = typeof url === "string" && url.startsWith("http") ? url : null;
  } catch {
    shareUrl = null;
  }
  const ref: ReasoningRef = { run_id: runId, share_url: shareUrl };
  return { ...base, reasoning_ref: ref };
}
