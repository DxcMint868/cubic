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

export interface ResolveApprovalResult {
  decision?: string;
  approval_id?: string;
  approval_outcome?: string;
  intent_id?: string;
  payment_required?: unknown;
  capability: TraceCapability | null;
  payment: unknown;
  execution: TraceExecution | null;
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
): Promise<ResolveApprovalResult> {
  return request<ResolveApprovalResult>(
    `/api/approvals/${encodeURIComponent(id)}/resolve`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outcome }),
    },
  );
}

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
