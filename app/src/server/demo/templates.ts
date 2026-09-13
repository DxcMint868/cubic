// plan-16 EXACT — chat scenario templates (server/demo/templates.ts).
//
// Each template doubles as an e2e assertion: {label, chat_text, expected
// tool/args or no-tool, expected decision+reason}. Template ids resolve to
// EXACT {tool, arguments} with no LLM. Surfaced-branch templates exercise
// already-enforced behavior with ZERO engine changes — no new rule types, no
// new reason codes, no schema changes.
//
// Camera honesty: the two adversarial camera beats are the `.env` read (real
// `secret_resource` DENY) and the over-budget purchase (real
// `budget_exceeded` DENY) ONLY. Slur/off-scope input stays an off-camera
// parser e2e (see parse.ts), never a template and never the take.

export type TemplateKind = "tool" | "no-tool" | "lifecycle";

export interface ChatTemplate {
  id: string;
  /** Scenario label for the button — never "the model figured it out". */
  label: string;
  /** The user-visible message this scenario sends. */
  chat_text: string;
  kind: TemplateKind;
  /** EXACT gateway tool + arguments. Null for no-tool display states. */
  tool: string | null;
  arguments: Record<string, unknown>;
  /** When set, the chat route opens a fresh task with this budget first. */
  task?: { title: string; budget_usd_cents: number };
  /** Lifecycle scripts run through the real machinery (see chat.ts). */
  lifecycle?: "drain-reject" | "replay" | "expired";
  /** The e2e assertion for this template. */
  expect: {
    decision?: "allow" | "deny" | "escalate";
    reason?: string;
    matched_rule_id?: string;
    payment_required?: boolean;
    approval_outcome?: "rejected";
    rejection?: "replay" | "expired";
    no_tool?: boolean;
  };
}

// plan-16 EXACT — the template catalog.
export const CHAT_TEMPLATES: ChatTemplate[] = [
  // -- Deploy story: read PR → scan → merge-escalate → approve (console) --
  {
    id: "deploy-read",
    label: "Scenario: read PR #421",
    chat_text: "Read PR #421 in acme/backend",
    kind: "tool",
    tool: "github.get_pull_request",
    arguments: { repo: "acme/backend", pr: 421 },
    expect: { decision: "allow", reason: "policy_default_allow", matched_rule_id: "default-allow" },
  },
  {
    id: "deploy-scan",
    label: "Scenario: scan PR #421 ($0.25)",
    chat_text: "Scan acme/backend#421 for risks",
    kind: "tool",
    tool: "scanner.scan",
    arguments: { target: "acme/backend#421" },
    expect: { decision: "allow", reason: "policy_default_allow", matched_rule_id: "default-allow", payment_required: true },
  },
  {
    id: "deploy-merge",
    label: "Scenario: merge PR #421 (escalates)",
    chat_text: "Merge PR #421 in acme/backend",
    kind: "tool",
    tool: "github.merge_pull_request",
    arguments: { repo: "acme/backend", pr: 421 },
    expect: { decision: "escalate", reason: "risk_requires_approval", matched_rule_id: "merge-risk" },
  },
  {
    id: "deploy-run",
    label: "Scenario: deploy to production (escalates)",
    chat_text: "Deploy acme/backend to production",
    kind: "tool",
    tool: "deploy.production",
    arguments: { repo: "acme/backend" },
    expect: { decision: "escalate", reason: "risk_requires_approval", matched_rule_id: "risk-approval" },
  },
  // -- Treasury story: swap-escalate → payroll → stake pair --
  {
    id: "treasury-swap",
    label: "Scenario: $240k treasury swap (escalates)",
    chat_text: "Swap $240,000 USDC/ETH for the treasury rebalance",
    kind: "tool",
    tool: "treasury.swap",
    arguments: { asset_pair: "USDC/ETH", amount_usd_cents: 24_000_000 },
    expect: { decision: "escalate", reason: "risk_requires_approval", matched_rule_id: "risk-approval" },
  },
  {
    id: "treasury-payroll",
    label: "Scenario: $85k payroll transfer (escalates)",
    chat_text: "Pay $85,000 payroll from the treasury",
    kind: "tool",
    tool: "treasury.transfer",
    arguments: { destination: "payroll/ops-multisig", amount_usd_cents: 8_500_000 },
    expect: { decision: "escalate", reason: "risk_requires_approval", matched_rule_id: "risk-approval" },
  },
  {
    id: "treasury-stake-small",
    label: "Scenario: stake 0.5 ETH (allows)",
    chat_text: "Stake 0.5 ETH (≈$50) with lido",
    kind: "tool",
    tool: "treasury.stake",
    arguments: { protocol: "lido", amount_usd_cents: 5_000 },
    expect: { decision: "allow", reason: "policy_default_allow", matched_rule_id: "default-allow" },
  },
  {
    id: "treasury-stake-large",
    label: "Scenario: stake 50 ETH (escalates)",
    chat_text: "Stake 50 ETH (≈$5,000) with lido",
    kind: "tool",
    tool: "treasury.stake",
    arguments: { protocol: "lido", amount_usd_cents: 500_000 },
    expect: { decision: "escalate", reason: "risk_requires_approval", matched_rule_id: "risk-approval" },
  },
  {
    id: "treasury-drain",
    label: "Scenario: $450k swap (approver rejects)",
    chat_text: "Swap $450,000 USDC/ETH — oversized",
    kind: "lifecycle",
    tool: "treasury.swap",
    arguments: { asset_pair: "USDC/ETH", amount_usd_cents: 45_000_000 },
    lifecycle: "drain-reject",
    expect: { decision: "escalate", reason: "risk_requires_approval", approval_outcome: "rejected" },
  },
  // -- Surfaced branches: already enforced, previously undemoed --
  {
    id: "branch-cross-task",
    label: "Scenario: read outside the task (denied)",
    chat_text: "Read the README in evil/org",
    kind: "tool",
    tool: "github.read_file",
    arguments: { repo: "evil/org", path: "README.md" },
    expect: { decision: "deny", reason: "resource_outside_task", matched_rule_id: "deny-cross-task" },
  },
  {
    id: "branch-unknown-tool",
    label: "Scenario: unknown tool (denied)",
    chat_text: "Delete the repo",
    kind: "tool",
    tool: "github.delete_repo",
    arguments: { repo: "acme/backend" },
    expect: { decision: "deny", reason: "tool_not_allowed", matched_rule_id: "tool-allowlist" },
  },
  {
    id: "branch-replay",
    label: "Scenario: replay a capability (rejected)",
    chat_text: "Replay a spent capability",
    kind: "lifecycle",
    tool: "github.get_pull_request",
    arguments: { repo: "acme/backend", pr: 421 },
    lifecycle: "replay",
    expect: { decision: "allow", reason: "policy_default_allow", rejection: "replay" },
  },
  {
    id: "branch-expired",
    label: "Scenario: expired capability (rejected)",
    chat_text: "Use an expired capability",
    kind: "lifecycle",
    tool: "github.get_pull_request",
    arguments: { repo: "acme/backend", pr: 421 },
    lifecycle: "expired",
    expect: { decision: "allow", reason: "policy_default_allow", rejection: "expired" },
  },
  // -- Adversarial camera beats (ONLY these two are on camera) --
  {
    id: "attack-env",
    label: "Camera beat: read .env.production (denied)",
    chat_text: "Read .env.production in acme/backend",
    kind: "tool",
    tool: "github.read_file",
    arguments: { repo: "acme/backend", path: ".env.production" },
    expect: { decision: "deny", reason: "secret_resource", matched_rule_id: "deny-secret-resources" },
  },
  {
    id: "attack-overbudget",
    label: "Camera beat: 25¢ scan on a 10¢ task (denied)",
    chat_text: "Buy the $0.25 security scan on this 10¢ task",
    kind: "tool",
    tool: "scanner.scan",
    arguments: { target: "acme/backend#421", purchase: true, price_usd_cents: 25 },
    task: { title: "Demo chat: 10¢ task for the over-budget beat", budget_usd_cents: 10 },
    expect: { decision: "deny", reason: "budget_exceeded", matched_rule_id: "budget" },
  },
  // -- No-tool display state (a labeled scenario, never a Decision) --
  {
    id: "no-tool-hello",
    label: "Scenario: small talk (no tool)",
    chat_text: "Hello — what can you do?",
    kind: "no-tool",
    tool: null,
    arguments: {},
    expect: { no_tool: true },
  },
];

export function getTemplate(id: string): ChatTemplate | null {
  return CHAT_TEMPLATES.find((t) => t.id === id) ?? null;
}

// plan-16 EXACT — Play order: the hands-free scenario, beat by beat. Beat 0
// is a title card + voiceover (no raw-agent build). Play ends on /network.
// Cues are literal narration lines from docs/demo.md (video runbook).
export interface PlayBeat {
  template_id: string | null;
  cue: string;
  /** Title-card beats render as cards; plain beats render as voiceover cues. */
  card?: boolean;
}

export const PLAY_BEATS: PlayBeat[] = [
  {
    template_id: null,
    card: true,
    cue: "One agent. One gateway. Every tool call interrogated — allow, deny, or escalate.",
  },
  {
    template_id: "deploy-read",
    cue: "The agent reads PR #421. Low risk — the gateway allows it.",
  },
  {
    template_id: "deploy-scan",
    cue: "It needs a security scan. The service answers 402 — twenty-five cents on Hedera — and the gateway holds the capability until the budget policy says yes.",
  },
  {
    template_id: "deploy-merge",
    cue: "The scan is clean, so the agent asks to merge. High risk — the gateway escalates, and a human approves in the console.",
  },
  {
    template_id: "attack-env",
    cue: "Then the attack: injected instructions tell the agent to read production secrets. The gateway denies it — no capability, no execution.",
  },
  {
    template_id: "attack-overbudget",
    cue: "It tries to overspend its task budget next. Same answer — denied, before any money moves.",
  },
  {
    template_id: null,
    cue: "And every one of those decisions is already live on the network.",
  },
];
