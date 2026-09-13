import type { AuditEvent } from "@/lib/api";

export function parseTs(value: string | null | undefined): Date | null {
  if (!value) return null;
  let normalized = value.includes("T") ? value : value.replace(" ", "T");
  normalized = normalized.replace(/(\.\d{3})\d+/, "$1");
  normalized = normalized.replace(/([+-]\d{2})$/, "$1:00");
  if (!/[zZ]|[+-]\d{2}:\d{2}$/.test(normalized)) normalized = `${normalized}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function fmtTime(value: string | null | undefined): string {
  const date = parseTs(value);
  if (!date) return "—";
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function fmtDateTime(value: string | null | undefined): string {
  const date = parseTs(value);
  if (!date) return "—";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function fmtAge(value: string | null | undefined): string {
  const date = parseTs(value);
  if (!date) return "—";
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

export function shortId(value: string | null | undefined, length = 8): string {
  return value ? value.slice(0, length) : "—";
}

export function usd(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

export function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function laterOf(current: string | null, candidate: string): string {
  const currentTs = parseTs(current)?.getTime() ?? -1;
  const candidateTs = parseTs(candidate)?.getTime() ?? -1;
  return candidateTs > currentTs ? candidate : (current ?? candidate);
}

export interface TaskSummary {
  id: string;
  agentIds: string[];
  descriptor: string;
  intents: number;
  allowed: number;
  denied: number;
  escalated: number;
  pendingApprovals: number;
  payments: number;
  eventCount: number;
  lastEventAt: string | null;
  status: "RUNNING" | "AWAITING APPROVAL" | "DONE" | "FAILED";
}

export function deriveTasks(events: AuditEvent[]): TaskSummary[] {
  const byTask = new Map<string, TaskSummary>();
  const completed = new Map<string, "completed" | "failed">();

  for (const event of events) {
    const taskId = event.task_id;
    if (!taskId) continue;
    let task = byTask.get(taskId);
    if (!task) {
      task = {
        id: taskId,
        agentIds: [],
        descriptor: "—",
        intents: 0,
        allowed: 0,
        denied: 0,
        escalated: 0,
        pendingApprovals: 0,
        payments: 0,
        eventCount: 0,
        lastEventAt: null,
        status: "RUNNING",
      };
      byTask.set(taskId, task);
    }
    task.eventCount += 1;
    task.lastEventAt = laterOf(task.lastEventAt, event.created_at);
    if (event.agent_id && !task.agentIds.includes(event.agent_id)) {
      task.agentIds.push(event.agent_id);
    }

    const payload = event.payload;
    switch (event.event_type) {
      case "intent.created": {
        task.intents += 1;
        if (task.descriptor === "—") {
          const tool = asString(payload.tool) ?? "unknown";
          const resource = asString(payload.resource);
          task.descriptor = resource ? `${tool} · ${resource}` : tool;
        }
        break;
      }
      case "policy.evaluated": {
        const decision = asString(payload.decision);
        if (decision === "allow") task.allowed += 1;
        else if (decision === "deny") task.denied += 1;
        else if (decision === "escalate") task.escalated += 1;
        break;
      }
      case "payment.requested":
        task.payments += 1;
        break;
      case "task.completed": {
        const status = asString(payload.status);
        if (status === "completed" || status === "failed") completed.set(taskId, status);
        break;
      }
      default:
        break;
    }
  }

  const approvals = deriveApprovals(events);
  const pendingByTask = new Map<string, number>();
  for (const item of approvals.pending) {
    if (!item.taskId) continue;
    pendingByTask.set(item.taskId, (pendingByTask.get(item.taskId) ?? 0) + 1);
  }

  for (const task of byTask.values()) {
    task.pendingApprovals = pendingByTask.get(task.id) ?? 0;
    const done = completed.get(task.id);
    if (done === "completed") task.status = "DONE";
    else if (done === "failed") task.status = "FAILED";
    else if (task.pendingApprovals > 0) task.status = "AWAITING APPROVAL";
  }

  return [...byTask.values()].sort(
    (a, b) => (parseTs(b.lastEventAt)?.getTime() ?? 0) - (parseTs(a.lastEventAt)?.getTime() ?? 0),
  );
}

export interface ApprovalItem {
  approvalId: string;
  decisionId: string;
  intentId: string | null;
  taskId: string | null;
  agentId: string | null;
  provider: string;
  action: string;
  resource: string;
  requestedAt: string;
  status: "pending" | "approved" | "rejected";
  completedAt: string | null;
  reasons: string[];
  matchedPolicy: string | null;
  matchedRuleId: string | null;
  riskScore: number | null;
  council: string | null;
  signer: string | null;
  resolvedBy: string | null;
}

export function deriveApprovals(events: AuditEvent[]): {
  pending: ApprovalItem[];
  resolved: ApprovalItem[];
} {
  const byId = new Map<string, ApprovalItem>();

  const ensure = (id: string): ApprovalItem => {
    let item = byId.get(id);
    if (!item) {
      item = {
        approvalId: id,
        decisionId: "",
        intentId: null,
        taskId: null,
        agentId: null,
        provider: "—",
        action: "—",
        resource: "—",
        requestedAt: "",
        status: "pending",
        completedAt: null,
        reasons: [],
        matchedPolicy: null,
        matchedRuleId: null,
        riskScore: null,
        council: null,
        signer: null,
        resolvedBy: null,
      };
      byId.set(id, item);
    }
    return item;
  };

  const ordered = [...events].sort((a, b) => a.id - b.id);

  // policy.evaluated fires BEFORE the approval row + requested event exist,
  // so the decision→policy join can't resolve in one pass. Pre-scan first.
  const policyByDecision = new Map<string, { policy: string | null; rule: string | null; score: number | null }>();
  for (const event of ordered) {
    if (event.event_type !== "policy.evaluated") continue;
    const decisionId = asString(event.payload.decision_id);
    if (!decisionId || policyByDecision.has(decisionId)) continue;
    policyByDecision.set(decisionId, {
      policy: asString(event.payload.matched_policy),
      rule: asString(event.payload.matched_rule_id),
      score: asNumber(event.payload.risk_score),
    });
  }

  const applyPolicy = (item: ApprovalItem): void => {
    if (!item.decisionId) return;
    const join = policyByDecision.get(item.decisionId);
    if (!join) return;
    item.matchedPolicy = join.policy;
    item.matchedRuleId = join.rule;
    item.riskScore = join.score;
  };

  for (const event of ordered) {
    const payload = event.payload;
    if (event.event_type === "ledger.approval.requested") {
      const id = asString(payload.approval_id);
      if (!id) continue;
      const item = ensure(id);
      item.decisionId = asString(payload.decision_id) ?? item.decisionId;
      item.provider = asString(payload.provider) ?? item.provider;
      item.action = asString(payload.action) ?? item.action;
      item.resource = asString(payload.resource) ?? item.resource;
      item.requestedAt = event.created_at;
      item.taskId = event.task_id;
      item.agentId = event.agent_id;
      item.council = asString(payload.council) ?? item.council;
      applyPolicy(item);
    } else if (event.event_type === "ledger.approval.completed") {
      const id = asString(payload.approval_id);
      if (!id) continue;
      const item = ensure(id);
      const outcome = asString(payload.outcome);
      item.status = outcome === "approved" ? "approved" : "rejected";
      item.completedAt = event.created_at;
      item.provider = asString(payload.provider) ?? item.provider;
      item.signer = asString(payload.signer) ?? item.signer;
      item.resolvedBy = asString(payload.resolved_by) ?? item.resolvedBy;
      item.council = asString(payload.council) ?? item.council;
      if (!item.requestedAt) item.requestedAt = event.created_at;
    } else if (event.event_type === "capability.escalated") {
      const id = asString(payload.approval_id);
      if (!id) continue;
      const item = ensure(id);
      item.decisionId = asString(payload.decision_id) ?? item.decisionId;
      item.intentId = asString(payload.intent_id) ?? item.intentId;
      item.reasons = asStringArray(payload.reason_codes);
      item.council = asString(payload.council) ?? item.council;
      applyPolicy(item);
    } else if (event.event_type === "policy.evaluated") {
      const decisionId = asString(payload.decision_id);
      if (!decisionId) continue;
      const match = [...byId.values()].find((item) => item.decisionId === decisionId);
      if (!match) continue;
      match.matchedPolicy = asString(payload.matched_policy);
      match.matchedRuleId = asString(payload.matched_rule_id);
      match.riskScore = asNumber(payload.risk_score);
    }
  }

  const all = [...byId.values()];
  const pending = all
    .filter((item) => item.status === "pending")
    .sort((a, b) => (parseTs(b.requestedAt)?.getTime() ?? 0) - (parseTs(a.requestedAt)?.getTime() ?? 0));
  const resolved = all
    .filter((item) => item.status !== "pending")
    .sort(
      (a, b) =>
        (parseTs(b.completedAt)?.getTime() ?? 0) - (parseTs(a.completedAt)?.getTime() ?? 0),
    );
  return { pending, resolved };
}

// Approvers = council members (authorized to decide) + whoever actually
// resolved approvals (from ledger.approval.completed events). A member who
// never resolved shows 0/0 with their council tag; a non-member resolver
// (e.g. unsigned dev stand-in) shows as attribution. Identity = wallet signer
// when signed, else the resolved_by attribution string.
export interface ApproverItem {
  id: string;
  address: string | null;
  resolved: number;
  approved: number;
  rejected: number;
  signed: number;
  lastAt: string | null;
  councils: string[];
}

export function deriveApprovers(
  events: AuditEvent[],
  councilList: Array<{ name: string; members: string[] }> = [],
): ApproverItem[] {
  const byId = new Map<string, ApproverItem>();
  const ensure = (id: string, address: string | null): ApproverItem => {
    let item = byId.get(id);
    if (!item) {
      item = { id, address, resolved: 0, approved: 0, rejected: 0, signed: 0, lastAt: null, councils: [] };
      byId.set(id, item);
    }
    return item;
  };
  for (const c of councilList) {
    for (const member of c.members) {
      const item = ensure(member.toLowerCase(), member);
      if (!item.councils.includes(c.name)) item.councils.push(c.name);
    }
  }
  const ordered = [...events].sort((a, b) => a.id - b.id);
  for (const event of ordered) {
    if (event.event_type !== "ledger.approval.completed") continue;
    const signer = asString(event.payload.signer);
    const resolvedBy = asString(event.payload.resolved_by);
    const id = signer ?? resolvedBy ?? "unknown";
    const key = signer ? signer.toLowerCase() : id;
    const item = byId.get(key) ?? {
      id,
      address: signer,
      resolved: 0,
      approved: 0,
      rejected: 0,
      signed: 0,
      lastAt: null as string | null,
      councils: [] as string[],
    };
    item.resolved += 1;
    if (asString(event.payload.outcome) === "approved") item.approved += 1;
    else item.rejected += 1;
    if (signer) item.signed += 1;
    item.lastAt = event.created_at;
    byId.set(key, item);
  }
  return [...byId.values()].sort(
    (a, b) => (parseTs(b.lastAt)?.getTime() ?? 0) - (parseTs(a.lastAt)?.getTime() ?? 0),
  );
}

export interface PaymentItem {
  paymentId: string;
  capabilityId: string;
  service: string;
  network: string;
  amountUsdCents: number | null;
  taskId: string | null;
  agentId: string | null;
  status: "requested" | "completed" | "failed";
  settlementRef: string | null;
  errorCode: string | null;
  requestedAt: string;
  settledAt: string | null;
}

export function derivePayments(events: AuditEvent[]): PaymentItem[] {
  const byId = new Map<string, PaymentItem>();

  for (const event of events) {
    const payload = event.payload;
    if (
      event.event_type !== "payment.requested" &&
      event.event_type !== "payment.completed" &&
      event.event_type !== "payment.failed"
    ) {
      continue;
    }
    const id = asString(payload.payment_id);
    if (!id) continue;
    let item = byId.get(id);
    if (!item) {
      item = {
        paymentId: id,
        capabilityId: asString(payload.capability_id) ?? "—",
        service: "—",
        network: "hedera",
        amountUsdCents: null,
        taskId: event.task_id,
        agentId: event.agent_id,
        status: "requested",
        settlementRef: null,
        errorCode: null,
        requestedAt: event.created_at,
        settledAt: null,
      };
      byId.set(id, item);
    }
    if (event.event_type === "payment.requested") {
      item.service = asString(payload.service) ?? item.service;
      item.network = asString(payload.network) ?? item.network;
      item.amountUsdCents = asNumber(payload.amount_usd_cents) ?? item.amountUsdCents;
      item.requestedAt = event.created_at;
    } else if (event.event_type === "payment.completed") {
      item.status = "completed";
      item.settlementRef = asString(payload.settlement_ref);
      item.settledAt = event.created_at;
    } else {
      item.status = "failed";
      item.errorCode = asString(payload.error_code);
      item.settledAt = event.created_at;
    }
  }

  return [...byId.values()].sort(
    (a, b) => (parseTs(b.requestedAt)?.getTime() ?? 0) - (parseTs(a.requestedAt)?.getTime() ?? 0),
  );
}

export interface PolicyObservation {
  policy: string;
  ruleId: string;
  allow: number;
  deny: number;
  escalate: number;
  lastSeen: string | null;
}

export function derivePolicies(events: AuditEvent[]): PolicyObservation[] {
  const byKey = new Map<string, PolicyObservation>();
  for (const event of events) {
    if (event.event_type !== "policy.evaluated") continue;
    const policy = asString(event.payload.matched_policy) ?? "—";
    const ruleId = asString(event.payload.matched_rule_id) ?? "—";
    const key = `${policy}|${ruleId}`;
    let item = byKey.get(key);
    if (!item) {
      item = { policy, ruleId, allow: 0, deny: 0, escalate: 0, lastSeen: null };
      byKey.set(key, item);
    }
    const decision = asString(event.payload.decision);
    if (decision === "allow") item.allow += 1;
    else if (decision === "deny") item.deny += 1;
    else if (decision === "escalate") item.escalate += 1;
    item.lastSeen = laterOf(item.lastSeen, event.created_at);
  }
  return [...byKey.values()].sort((a, b) => b.allow + b.deny + b.escalate - (a.allow + a.deny + a.escalate));
}

export interface AgentStats {
  agentId: string;
  taskIds: string[];
  intents: number;
  allowed: number;
  denied: number;
  escalated: number;
  approvals: number;
  lastEventAt: string | null;
}

export function deriveAgents(events: AuditEvent[]): AgentStats[] {
  const byId = new Map<string, AgentStats>();
  for (const event of events) {
    const agentId = event.agent_id;
    if (!agentId) continue;
    let item = byId.get(agentId);
    if (!item) {
      item = {
        agentId,
        taskIds: [],
        intents: 0,
        allowed: 0,
        denied: 0,
        escalated: 0,
        approvals: 0,
        lastEventAt: null,
      };
      byId.set(agentId, item);
    }
    item.lastEventAt = laterOf(item.lastEventAt, event.created_at);
    if (event.task_id && !item.taskIds.includes(event.task_id)) item.taskIds.push(event.task_id);
    if (event.event_type === "intent.created") item.intents += 1;
    if (event.event_type === "policy.evaluated") {
      const decision = asString(event.payload.decision);
      if (decision === "allow") item.allowed += 1;
      else if (decision === "deny") item.denied += 1;
      else if (decision === "escalate") item.escalated += 1;
    }
    if (event.event_type === "ledger.approval.requested") item.approvals += 1;
  }
  return [...byId.values()].sort(
    (a, b) => (parseTs(b.lastEventAt)?.getTime() ?? 0) - (parseTs(a.lastEventAt)?.getTime() ?? 0),
  );
}

export interface Counters {
  agents: number;
  intents: number;
  allowed: number;
  denied: number;
  escalated: number;
  pendingApprovals: number;
  paymentsCompleted: number;
  settledCents: number;
}

export function deriveCounters(events: AuditEvent[]): Counters {
  const payments = derivePayments(events);
  const settled = payments.filter((payment) => payment.status === "completed");
  const counters: Counters = {
    agents: deriveAgents(events).length,
    intents: 0,
    allowed: 0,
    denied: 0,
    escalated: 0,
    pendingApprovals: deriveApprovals(events).pending.length,
    paymentsCompleted: settled.length,
    settledCents: settled.reduce((sum, payment) => sum + (payment.amountUsdCents ?? 0), 0),
  };
  for (const event of events) {
    if (event.event_type === "intent.created") counters.intents += 1;
    else if (event.event_type === "policy.evaluated") {
      const decision = asString(event.payload.decision);
      if (decision === "allow") counters.allowed += 1;
      else if (decision === "deny") counters.denied += 1;
      else if (decision === "escalate") counters.escalated += 1;
    }
  }
  return counters;
}

// HCS topic-explorer link. Pure string build — the topic id rides on each
// anchor object from the server (real-or-absent); "testnet" matches the demo's
// HEDERA_NETWORK (see TraceView.hashscanUrl for the same assumption).
export function eventSummary(event: AuditEvent): string {
  const payload = event.payload;
  switch (event.event_type) {
    case "intent.created": {
      const tool = asString(payload.tool) ?? "?";
      const resource = asString(payload.resource);
      const risk = asString(payload.risk_class);
      return `${tool}${resource ? ` · ${resource}` : ""}${risk ? ` · risk ${risk}` : ""}`;
    }
    case "policy.evaluated": {
      const decision = asString(payload.decision)?.toUpperCase() ?? "?";
      const rule = asString(payload.matched_rule_id) ?? "?";
      const reasons = asStringArray(payload.reason_codes).join(", ");
      return `${decision} · ${rule}${reasons ? ` · ${reasons}` : ""}`;
    }
    case "capability.issued": {
      const action = asString(payload.action) ?? "?";
      const resource = asString(payload.resource);
      return `${action}${resource ? ` · ${resource}` : ""} · nonce ${shortId(
        asString(payload.nonce),
        8,
      )}`;
    }
    case "capability.denied":
      return `denied · ${asStringArray(payload.reason_codes).join(", ") || "no reason"}`;
    case "capability.escalated":
      return `escalated · ${asStringArray(payload.reason_codes).join(", ") || "no reason"}`;
    case "capability.consumed":
      return `consumed ${shortId(asString(payload.capability_id))}`;
    case "capability.rejected":
      return `rejected · ${asString(payload.reason) ?? "?"}`;
    case "capability.revoked": // plan-13: the sanctioned 18th event type
      return `revoked · ${asString(payload.reason) ?? "?"}`;
    case "ledger.approval.requested":
      return `${asString(payload.provider) ?? "?"} · ${asString(payload.action) ?? "?"}${
        asString(payload.resource) ? ` · ${asString(payload.resource)}` : ""
      }`;
    case "ledger.approval.completed":
      return `${asString(payload.outcome) ?? "?"} · provider ${asString(payload.provider) ?? "?"}`;
    case "payment.requested":
      return `${asString(payload.service) ?? "?"} · ${usd(asNumber(payload.amount_usd_cents))} · ${
        asString(payload.network) ?? "?"
      }`;
    case "payment.completed":
      return `settled · ${asString(payload.settlement_ref) ?? "—"}`;
    case "payment.failed":
      return `failed · ${asString(payload.error_code) ?? "?"}`;
    case "service.discovered":
      return `${asString(payload.service) ?? "?"} · ${usd(asNumber(payload.price_usd_cents))}`;
    case "tool.execution.started":
      return `${asString(payload.tool) ?? "?"} · started`;
    case "tool.execution.completed":
      return `${asString(payload.result_summary) ?? "completed"}`;
    case "tool.execution.failed":
      return `failed · ${asString(payload.error_code) ?? "?"}`;
    case "task.completed":
      return `${asString(payload.status) ?? "?"}${
        asString(payload.summary) ? ` · ${asString(payload.summary)}` : ""
      }`;
    default:
      return "";
  }
}
