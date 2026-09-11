// Console mock store — every list below is static UI copy until the
// gateway API / DB reads land. Shapes mirror PROJECT.md §4 + §12.
import { MOCK_AGENTS } from "@/data/agents";

export const TENANT = { name: "acme", plan: "TEAM", chain: "SEPOLIA" };

export const OVERVIEW_STATS = [
  { value: "6", label: "TENANT AGENTS" },
  { value: "1,284", label: "INTENTS TODAY" },
  { value: "96.2%", label: "ALLOW RATE" },
  { value: "3", label: "PENDING APPROVALS" },
];

export type Task = {
  id: string;
  goal: string;
  agent: string;
  intents: number;
  allowed: number;
  escalated: number;
  denied: number;
  status: "RUNNING" | "AWAITING APPROVAL" | "DONE" | "BLOCKED";
};

export const TASKS: Task[] = [
  { id: "task:9b17", goal: "Review PR #421 and deploy if safe", agent: "deploy-agent", intents: 14, allowed: 11, escalated: 2, denied: 1, status: "AWAITING APPROVAL" },
  { id: "task:3f02", goal: "Nightly security scan across services", agent: "scan-seeker", intents: 9, allowed: 8, escalated: 1, denied: 0, status: "RUNNING" },
  { id: "task:77aa", goal: "Refund customer #4821", agent: "pay-runner", intents: 6, allowed: 4, escalated: 1, denied: 1, status: "BLOCKED" },
  { id: "task:51c9", goal: "Summarize CI failures for backend", agent: "ci-herald", intents: 5, allowed: 5, escalated: 0, denied: 0, status: "DONE" },
];

export type Policy = {
  id: string;
  name: string;
  scope: string;
  version: string;
  rules: string;
  enabled: boolean;
  evaluated: string;
};

export const POLICIES: Policy[] = [
  { id: "production-merge-v3", name: "Production merge", scope: "deploy-agent · github.*", version: "v3", rules: "approved PR + CI passing + scan clean + rep ≥ 0.80 + hardware approval", enabled: true, evaluated: "412× today" },
  { id: "spend-guard-v2", name: "Machine spend", scope: "all agents · x402.*", version: "v2", rules: "allowlisted service + ≤ $0.50/task + rep ≥ 0.75", enabled: true, evaluated: "88× today" },
  { id: "secret-wall-v1", name: "Secret exfil wall", scope: "all agents · *read*", version: "v1", rules: "deny *.env* + external destinations", enabled: true, evaluated: "1.2k× today" },
  { id: "chat-ops-v1", name: "External messaging", scope: "all agents · slack.*", version: "v1", rules: "escalate external channels, allow internal", enabled: false, evaluated: "paused" },
];

export type Approval = {
  id: string;
  action: string;
  resource: string;
  agent: string;
  risk: "HIGH" | "CRITICAL";
  context: string;
  hardware: boolean;
  age: string;
};

export const APPROVALS: Approval[] = [
  { id: "apr:101", action: "github.merge_pull_request", resource: "acme/backend#421", agent: "deploy-agent", risk: "HIGH", context: "rep 0.94 · CI green · scan clean", hardware: true, age: "2m" },
  { id: "apr:102", action: "x402.pay", resource: "scanner-123 · $0.25", agent: "scan-seeker", risk: "HIGH", context: "rep 0.86 · allowlisted · $0.31 / $0.50 budget", hardware: false, age: "6m" },
  { id: "apr:103", action: "transfer_funds", resource: "treasury · 250 USDC", agent: "pay-runner", risk: "CRITICAL", context: "rep 0.88 · above auto-spend cap", hardware: true, age: "11m" },
];

export type AuditEvent = {
  time: string;
  intent: string;
  agent: string;
  decision: "ALLOW" | "DENY" | "ESCALATE";
  capability: string;
  result: string;
};

export const AUDIT: AuditEvent[] = [
  { time: "14:02:11", intent: "merge PR #421", agent: "deploy-agent", decision: "ESCALATE", capability: "pending approval", result: "awaiting Ledger" },
  { time: "14:01:47", intent: "purchase security scan", agent: "scan-seeker", decision: "ALLOW", capability: "x402 $0.25 · 5m", result: "settled · clean" },
  { time: "13:58:03", intent: "read .env.production", agent: "deploy-agent", decision: "DENY", capability: "none", result: "prompt-injection wall" },
  { time: "13:55:29", intent: "get PR #421", agent: "deploy-agent", decision: "ALLOW", capability: "github.read · 5m", result: "success" },
  { time: "13:54:12", intent: "refund customer #4821", agent: "pay-runner", decision: "ESCALATE", capability: "pending approval", result: "over auto-spend cap" },
  { time: "13:51:40", intent: "post #eng-build", agent: "ci-herald", decision: "ALLOW", capability: "slack.post · 5m", result: "success" },
];

export type Payment = {
  id: string;
  service: string;
  amount: string;
  budget: string;
  task: string;
  tx: string;
  status: "SETTLED" | "PENDING" | "HELD";
};

export const PAYMENTS: Payment[] = [
  { id: "pay:881", service: "scanner-123", amount: "$0.25", budget: "$0.31 / $0.50", task: "task:3f02", tx: "0x8a…71cc", status: "SETTLED" },
  { id: "pay:880", service: "inference-xl", amount: "$0.12", budget: "$0.12 / $0.50", task: "task:9b17", tx: "0x2d…90be", status: "SETTLED" },
  { id: "pay:879", service: "scanner-123", amount: "$0.25", budget: "awaiting approval", task: "task:3f02", tx: "—", status: "PENDING" },
];

export { MOCK_AGENTS };
