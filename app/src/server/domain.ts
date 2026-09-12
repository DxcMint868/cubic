export type RiskClass = "low" | "medium" | "high" | "critical";
export type DecisionType = "allow" | "deny" | "escalate";

export interface ToolCall {
  task_id?: string;                    // uuid; omit → gateway uses the agent's latest open task
  agent_key: string;                   // "agent:8472"
  tool: string;                        // "github.merge_pull_request"
  arguments: Record<string, unknown>;
}

export interface NormalizedIntent {
  tool: string;                        // "github.merge_pull_request" (echoed from the ToolCall)
  action: string;                      // "read_file" | "merge_pull_request" | "purchase_security_scan" | ...
  resource: string;                    // "acme/backend#421" | "acme/backend/.env.production"
  risk_class: RiskClass;
  resource_class: "normal" | "secret" | "cross_task";
  amount_usd_cents?: number;           // present only for purchase intents
  // plan-11 contract addendum (single sanctioned addition): linked AI
  // reasoning trace for this normalization — a real LangSmith run id (plus a
  // best-effort public share URL) when the LLM-assist path ran with a key,
  // otherwise null. Never mocked, never fabricated: real or absent.
  reasoning_ref?: { run_id: string; share_url: string | null; model?: string } | null;
}

export interface Facts {
  agent_status: "active" | "suspended";
  agent_reputation: number;            // 0..1
  tool_default_risk: RiskClass;
  task_budget_usd_cents: number | null;
  budget_spent_usd_cents: number;      // sum of completed payments for the task
}

export type ReasonCode =
  | "secret_resource"
  | "resource_outside_task"
  | "tool_not_allowed"
  | "service_not_approved"
  | "budget_exceeded"
  | "reputation_below_threshold"
  | "risk_requires_approval"
  | "policy_default_allow"
  | "policy_default_deny"
  | "no_default_rule"
  | "approval_rejected"
  | "payment_failed";

export interface Reason { code: ReasonCode; detail?: string }

export interface DecisionResult {
  decision: DecisionType;
  matched_policy: string;              // "default-v1"
  matched_rule_id: string;             // "deny-secret-resources"
  reasons: Reason[];
  risk_score: 10 | 40 | 70 | 90;       // low | medium | high | critical
}

export interface IssuedCapability {
  capability_id: string;               // uuid
  subject: string;                     // "agent:8472"
  action: string;
  resource: string;
  constraints: Record<string, unknown>;
  budget_usd_cents: number | null;
  expires_at: string;                  // ISO-8601
  nonce: string;                       // 32-byte hex (64 chars)
  policy_hash: string;                 // sha256 hex of canonical matched-policy JSON
}

export const apiErrorCodes = [
  "AGENT_NOT_FOUND", "TASK_NOT_FOUND", "TOOL_NOT_FOUND", "INVALID_REQUEST",
  "CAPABILITY_REJECTED", "PAYMENT_REQUIRED", "INTERNAL",
] as const;
export type ApiErrorCode = (typeof apiErrorCodes)[number];
