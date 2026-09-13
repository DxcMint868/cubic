import { useCallback, useEffect, useRef, useState } from "react";

export type ApiErrorCode =
  | "AGENT_NOT_FOUND"
  | "TASK_NOT_FOUND"
  | "TOOL_NOT_FOUND"
  | "INVALID_REQUEST"
  | "CAPABILITY_REJECTED"
  | "PAYMENT_REQUIRED"
  | "INTERNAL";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 0) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

type Envelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { cache: "no-store", ...init });
  } catch (err) {
    throw new ApiError(
      "INTERNAL",
      err instanceof Error ? err.message : "network request failed",
    );
  }

  let body: Envelope<T> | null = null;
  try {
    body = (await res.json()) as Envelope<T>;
  } catch {
    body = null;
  }
  if (!body) {
    throw new ApiError("INTERNAL", `unexpected response (${res.status})`, res.status);
  }
  if (!body.ok) {
    throw new ApiError(body.error.code, body.error.message, res.status);
  }
  return body.data;
}

export interface AuditEvent {
  id: number;
  event_type: string;
  tenant_id: string | null;
  task_id: string | null;
  agent_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface TraceIntent {
  id: string;
  tool: string;
  resource: string | null;
  arguments_redacted: Record<string, unknown> | null;
  risk_class: string;
  origin: string;
  normalized: unknown;
  created_at: string;
}

export interface TraceReason {
  code: string;
  detail?: string;
}

export interface TraceDecision {
  id: string;
  decision: "allow" | "deny" | "escalate";
  matched_policy: string;
  matched_rule_id: string;
  reasons: TraceReason[];
  context_snapshot_hash: string;
  risk_score: number;
  created_at: string;
}

export interface TraceCapability {
  id: string;
  subject: string;
  action: string;
  resource: string;
  constraints: Record<string, unknown>;
  budget_usd_cents: number | null;
  expires_at: string;
  nonce: string;
  policy_hash: string;
  status: string;
}

export interface TracePayment {
  id: string;
  service: string;
  network: string;
  amount_usd_cents: number;
  status: string;
  x402_ref: string | null;
  created_at: string;
  settled_at: string | null;
}

export interface TraceExecution {
  id: string;
  tool: string;
  status: string;
  executor: string;
  result_summary: string | null;
  error: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface TraceApproval {
  id: string;
  type: string;
  status: string;
  provider: string;
  provider_ref: string | null;
  requested_at: string;
  completed_at: string | null;
}

export interface TraceChainEntry {
  intent: TraceIntent;
  decision: TraceDecision | null;
  capability: TraceCapability | null;
  payments: TracePayment[];
  executions: TraceExecution[];
  approvals: TraceApproval[];
}

export interface Trace {
  task: {
    id: string;
    title: string;
    budget_usd_cents: number | null;
    status: string;
  };
  chain: TraceChainEntry[];
  events: {
    event_type: string;
    occurred_at: string;
    payload: Record<string, unknown>;
  }[];
}

export interface NetworkEvent {
  id: number;
  event_type: string;
  agent_pseudonym: string;
  agent_category: string;
  action_class: string;
  outcome: string;
  risk_class: string;
  created_at: string;
}

export interface NetworkStats {
  agents_observed: number;
  intents_evaluated: number;
  allowed: number;
  denied: number;
  escalated: number;
  payments_completed: number;
}

export interface ResolveCapability {
  capability_id: string;
  subject: string;
  action: string;
  resource: string;
  constraints: Record<string, unknown>;
  budget_usd_cents: number | null;
  expires_at: string;
  nonce: string;
  policy_hash: string;
}

export interface ResolveExecution {
  execution_id: string;
  status: "succeeded" | "failed";
  result_summary: string | null;
}

export interface ResolveApprovalResult {
  decision?: string;
  approval_id?: string;
  approval_outcome?: string;
  intent_id?: string;
  signer?: string | null;
  status?: string;
  council?: string;
  threshold?: number;
  collected?: number;
  payment_required?: unknown;
  capability: ResolveCapability | null;
  payment: unknown;
  execution: ResolveExecution | null;
}

export interface AnchorVerification {
  topic_id: string;
  network: string;
  topic_url: string;
  verified_count: number;
  total: number;
  events: Array<{ event_type: string; occurred_at: string; fingerprint: string; anchored: boolean; verified: boolean }>;
}

export function verifyTaskAnchors(taskId: string): Promise<AnchorVerification> {
  return request<AnchorVerification>(`/api/anchors/verify?task_id=${encodeURIComponent(taskId)}`);
}

export function getAuditEvents(
  opts: { limit?: number; taskId?: string; eventType?: string; beforeId?: number } = {},
): Promise<AuditEvent[]> {
  const params = new URLSearchParams();
  params.set("limit", String(opts.limit ?? 100));
  if (opts.taskId) params.set("task_id", opts.taskId);
  if (opts.eventType) params.set("event_type", opts.eventType);
  if (opts.beforeId != null) params.set("before_id", String(opts.beforeId));
  return request<{ events: AuditEvent[] }>(`/api/audit/events?${params}`).then(
    (data) => data.events,
  );
}

export function getTrace(taskId: string): Promise<Trace> {
  return request<Trace>(`/api/audit/trace/${encodeURIComponent(taskId)}`);
}

export async function getAuditEventsPaged(
  opts: { eventType?: string; maxPages?: number; pageSize?: number } = {},
): Promise<AuditEvent[]> {
  const maxPages = opts.maxPages ?? 5;
  const pageSize = opts.pageSize ?? 200;
  const rows: AuditEvent[] = [];
  let beforeId: number | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const batch = await getAuditEvents({
      limit: pageSize,
      eventType: opts.eventType,
      beforeId,
    });
    rows.push(...batch);
    if (batch.length < pageSize) break;
    beforeId = batch[batch.length - 1].id;
  }
  return rows;
}

export function getNetworkEvents(
  opts: { limit?: number; beforeId?: number } = {},
): Promise<NetworkEvent[]> {
  const params = new URLSearchParams();
  params.set("limit", String(opts.limit ?? 100));
  if (opts.beforeId != null) params.set("before_id", String(opts.beforeId));
  return request<{ events: NetworkEvent[] }>(`/api/network/events?${params}`).then(
    (data) => data.events,
  );
}

export function getNetworkStats(): Promise<NetworkStats> {
  return request<NetworkStats>("/api/network/stats");
}

export function resolveApproval(
  id: string,
  outcome: "approved" | "rejected",
  signature?: { signature: string; signer: string },
): Promise<ResolveApprovalResult> {
  return request<ResolveApprovalResult>(
    `/api/approvals/${encodeURIComponent(id)}/resolve`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outcome, ...(signature ?? {}) }),
    },
  );
}

// Canonical approval-signing message (EIP-191 personal_sign). Built here so
// the browser wallet and the verifying route sign/check identical bytes.
export { approvalSignMessage } from "./approval-message";

export function mergeNetworkEvents(
  a: NetworkEvent[],
  b: NetworkEvent[],
): NetworkEvent[] {
  const byId = new Map<number, NetworkEvent>();
  for (const event of a) byId.set(event.id, event);
  for (const event of b) byId.set(event.id, event);
  if (byId.size === a.length) return a;
  return [...byId.values()].sort((x, y) => x.id - y.id);
}

export function useApi<T>(
  key: string,
  loader: () => Promise<T>,
): { data: T | null; error: ApiError | null; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    loaderRef
      .current()
      .then((result) => {
        if (!alive) return;
        setData(result);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setError(
          err instanceof ApiError
            ? err
            : new ApiError("INTERNAL", err instanceof Error ? err.message : String(err)),
        );
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [key, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

const STREAM_BUFFER = 500;

export function useNetworkStream(): {
  events: NetworkEvent[];
  connected: boolean;
  error: string | null;
} {
  const [events, setEvents] = useState<NetworkEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const source = new EventSource("/api/network/stream");

    const onNetwork = (message: MessageEvent) => {
      let row: NetworkEvent;
      try {
        row = JSON.parse(message.data as string) as NetworkEvent;
      } catch {
        return;
      }
      if (typeof row?.id !== "number") return;
      setEvents((prev) => {
        if (prev.some((e) => e.id === row.id)) return prev;
        const next = [...prev, row];
        return next.length > STREAM_BUFFER ? next.slice(next.length - STREAM_BUFFER) : next;
      });
    };

    source.onopen = () => {
      setConnected(true);
      setError(null);
    };
    source.onerror = () => {
      setConnected(false);
      setError("live stream disconnected — retrying");
    };
    source.addEventListener("network", onNetwork as EventListener);

    return () => {
      source.removeEventListener("network", onNetwork as EventListener);
      source.close();
    };
  }, []);

  return { events, connected, error };
}

// plan-16 — demo chat fetchers (append-only).

export interface ChatTemplateSummary {
  id: string;
  label: string;
  chat_text: string;
  agent_key: string;
}

export interface ChatAgentSummary {
  agent_key: string;
  name: string;
}

export interface ChatTurn {
  kind: "tool" | "no-tool" | "lifecycle";
  template_id: string | null;
  chat_text: string;
  client_label: string;
  reply: string | null;
  task_id: string | null;
  tool: string | null;
  arguments: Record<string, unknown>;
  transport: "mcp" | "gateway" | null;
  intent: Record<string, unknown> | null;
  decision: "allow" | "deny" | "escalate" | null;
  matched_policy: string | null;
  matched_rule_id: string | null;
  reasons: Array<{ code: string; detail?: string }>;
  risk_score: number | null;
  approval: { id: string; provider: string; status: string } | null;
  approval_outcome: "approved" | "rejected" | null;
  capability: {
    capability_id: string;
    action: string;
    resource: string;
    nonce: string;
    expires_at: string;
  } | null;
  execution: { execution_id: string; status: string; result_summary: string | null } | null;
  payment: { payment_id: string; status: string; settlement_ref: string | null; error_code: string | null } | null;
  payment_required: { price_usd_cents: number; challenge: unknown } | null;
  lines: { capability?: string; execution?: string; payment?: string };
  receipt: { amount_usd_cents: number; network: string; ref: string; ref_kind: "settlement" | "challenge" } | null;
  rejections: Array<{ step: string; reason: string; capability_id: string }>;
  anchors: Array<{ event_type: string; fingerprint: string; topic_id: string | null; topic_url: string | null }>;
  trace_url: string | null;
  network_url: string;
  provider: { configured: boolean; model: string };
  tools: { connected: number | null };
  no_tool_message: string | null;
}

export interface ChatBootstrap {
  templates: ChatTemplateSummary[];
  agents: ChatAgentSummary[];
  provider: { configured: boolean; model: string };
  tools: { connected: number | null };
  client_label: string;
}

export interface ChatResponse {
  intent: Record<string, unknown> | null;
  decision: "allow" | "deny" | "escalate" | null;
  trace_url: string | null;
  network_url: string;
  turn: ChatTurn;
}

export function getChatBootstrap(): Promise<ChatBootstrap> {
  return request<ChatBootstrap>("/api/demo/chat");
}

export function postChatTurn(input: {
  message?: string;
  template_id?: string;
  task_id?: string;
  agent_key?: string;
}): Promise<ChatResponse> {
  return request<ChatResponse>("/api/demo/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

// Agent registry + profile (names, grants, reputation, SOUL/MEMORY).

export interface AgentRegistryEntry {
  id: string;
  agent_key: string;
  name: string;
  environment: string;
  status: string;
}

export interface AgentProfileTool {
  name: string;
  category: string;
  risk_class: string;
  origin: "mcp" | "direct";
}

export interface AgentProfile {
  id: string;
  agent_key: string;
  name: string;
  environment: string;
  status: string;
  erc8004_identity: string | null;
  reputation: {
    score: number;
    source: "agent0-subgraph" | "offline-fallback" | "static";
    identity: string | null;
    validation: "passed" | "failed" | "unknown";
    capabilities: string[];
    feedbackCount: number;
  };
  subgraph_docs_url: string;
  granted_tools: AgentProfileTool[];
  ungranted_tools: AgentProfileTool[];
  soul: string | null;
  memory: string | null;
}

export function getAgents(): Promise<AgentRegistryEntry[]> {
  return request<AgentRegistryEntry[]>("/api/console/agents");
}

export function getAgentProfile(id: string): Promise<AgentProfile> {
  return request<AgentProfile>(`/api/console/agents/${id}`);
}

// Councils (off-chain multisig) + policy rule→council assignment.

export interface Council {
  id: string;
  name: string;
  members: string[];
  threshold: number;
  safe_address: string | null;
}

export interface PolicyDocRule {
  id: string;
  type: string;
  decision: string;
  reason: string;
  council: string | null;
}

export interface PolicyDoc {
  name: string;
  version: number;
  rules: PolicyDocRule[];
}

export function getCouncils(): Promise<Council[]> {
  return request<Council[]>("/api/console/councils");
}

export function createCouncil(input: {
  name: string;
  members: string[];
  threshold: number;
  safe_address?: string | null;
}): Promise<Council> {
  return request<Council>("/api/console/councils", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function getPolicyDocs(): Promise<PolicyDoc[]> {
  return request<PolicyDoc[]>("/api/console/policies");
}

export function assignRuleCouncil(
  policy: string,
  ruleId: string,
  council: string | null,
): Promise<{ policy: string; rule: string; council: string | null }> {
  return request<{ policy: string; rule: string; council: string | null }>(
    `/api/console/policies/${encodeURIComponent(policy)}/rules/${encodeURIComponent(ruleId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ council }),
    },
  );
}
