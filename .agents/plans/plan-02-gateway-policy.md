---
guide: .agents/guides/guide-01-bootstrap.md
status: ready
depends-on: [plan-01-foundation]
---

# Plan 02 — Gateway core: ingest, intent normalization, deterministic policy

**HOW TO USE:** sections marked **EXACT** are verbatim contracts — copy them as written. If an EXACT block fails, STOP and report; never silently redesign. Steps are ordered.

## Objective

The heart of Cubic: `ToolCall` ingest → structured intent → deterministic ALLOW/DENY/ESCALATE, with full audit events and a task-trace API. The LLM (optional, env-gated) may only help normalize; the policy engine is pure and deterministic.

## Preconditions

plan-01 merged; plan-00 §B.1/§F/§G read (domain types, event payload fields, response envelope).

## Steps

1. **EXACT — `gateway/ingest.ts`** behavior:
   - Parse body as `ToolCall` (zod; fail → `INVALID_REQUEST`).
   - Look up agent by `agent_key` within the demo tenant → missing: `AGENT_NOT_FOUND`. Tool row → `TOOL_NOT_FOUND`. Task: `task_id` given → that task; omitted → agent's latest `open` task → none: `TASK_NOT_FOUND`.
   - **Redaction (EXACT):** any argument whose key matches `/token|secret|password|credential|private_key/i` is replaced with `"[REDACTED]"` before persisting to `intents.arguments_redacted`.
   - Insert `intents` row (`risk_class` = tool's `default_risk_class` initially, updated post-normalize; `origin` = `"agent"`).
   - Emit `intent.created` `{intent_id, tool, resource: null, risk_class, origin: "agent"}`.

2. **EXACT — `gateway/normalize.ts`** mapping (pure function of `(tool, args)`):

```text
github.get_pull_request   → action "get_pull_request",      resource `${args.repo}#${args.pr}`,  risk low
github.read_file          → action "read_file",             resource `${args.repo}/${args.path}`, risk low
github.merge_pull_request  → action "merge_pull_request",    resource `${args.repo}#${args.pr}`,  risk high
deploy.production         → action "deploy_production",     resource `${args.repo}`,              risk critical
scanner.scan  (args.purchase !== true) → action "scan",     resource `${args.target}`,           risk medium
scanner.scan  (args.purchase === true) → action "purchase_security_scan", resource `${args.target}`,
                                          risk medium, amount_usd_cents = args.price_usd_cents
task.complete             → action "task_complete",         resource = task_id,                  risk low

resource_class:
  "secret"     if tool == "github.read_file" && String(args.path).startsWith(".env")
  "cross_task" if args.repo is defined && args.repo !== "acme/backend"   // demo task repo literal
  "normal"     otherwise
```

   Optional LLM assist **only** behind `LLM_INTENT_PROVIDER`; on any error or if unset, the rules above are the output. Update the intent row's `normalized` + `risk_class` after normalizing.

3. **EXACT — facts builder** (`gateway/context/provider.ts`): `StaticContextProvider.getFacts(intent, ctx)` returns `{ agent_status: <agents.status>, agent_reputation: 0.95, tool_default_risk: <tools.default_risk_class>, task_budget_usd_cents: <tasks.budget_usd_cents>, budget_spent_usd_cents: SELECT coalesce(sum(amount_usd_cents),0) FROM payments WHERE task's payments completed }`. `budget_spent_usd_cents` = sum of `payments.amount_usd_cents` joined via capability → decision → intent → task where `payments.status = 'completed'`. plan-07 replaces the reputation source; the `Facts` shape does not change.

4. **EXACT — policy rule documents.** Replace the three stub policy `rules` in `demo/seed.ts` with exactly these (and add a `serviceFor` helper):

```json
"default-v1": { "version": 1, "rules": [
  { "id": "deny-secret-resources", "type": "resource_class", "match": ["secret"], "decision": "deny", "reason": "secret_resource" },
  { "id": "deny-cross-task", "type": "resource_class", "match": ["cross_task"], "decision": "deny", "reason": "resource_outside_task" },
  { "id": "tool-allowlist", "type": "tool_allowlist",
    "tools": ["github.get_pull_request", "github.read_file", "github.merge_pull_request", "deploy.production", "scanner.scan", "task.complete"],
    "decision": "deny", "reason": "tool_not_allowed" },
  { "id": "reputation-floor", "type": "min_reputation", "min": 0.80, "decision": "escalate", "reason": "reputation_below_threshold" },
  { "id": "risk-approval", "type": "risk_class", "match": ["high", "critical"], "decision": "escalate", "reason": "risk_requires_approval" },
  { "id": "default-allow", "type": "default", "decision": "allow", "reason": "policy_default_allow" }
]}

"payment-v1": { "version": 1, "rules": [
  { "id": "service-allowlist", "type": "service_allowlist", "services": ["scanner"], "decision": "deny", "reason": "service_not_approved" },
  { "id": "budget", "type": "budget", "decision": "deny", "reason": "budget_exceeded" },
  { "id": "reputation-floor", "type": "min_reputation", "min": 0.80, "decision": "escalate", "reason": "reputation_below_threshold" },
  { "id": "default-allow", "type": "default", "decision": "allow", "reason": "policy_default_allow" }
]}

"production-merge-v1": { "version": 1, "rules": [
  { "id": "merge-only", "type": "tool_allowlist", "tools": ["github.merge_pull_request"], "decision": "deny", "reason": "tool_not_allowed" },
  { "id": "merge-reputation", "type": "min_reputation", "min": 0.90, "decision": "escalate", "reason": "reputation_below_threshold" },
  { "id": "merge-risk", "type": "risk_class", "match": ["high"], "decision": "escalate", "reason": "risk_requires_approval" },
  { "id": "default-deny", "type": "default", "decision": "deny", "reason": "policy_default_deny" }
]}
```

5. **EXACT — policy selection:**

```text
selectPolicy(intent):
  if intent.amount_usd_cents != null → "payment-v1"
  else if intent.action == "merge_pull_request" → "production-merge-v1"
  else → "default-v1"
```

6. **EXACT — `gateway/policy/engine.ts`** rule semantics (evaluate in array order, first match wins):

```text
resource_class   applies if intent.resource_class ∈ rule.match
tool_allowlist   applies if intent.tool ∉ rule.tools
service_allowlist applies if serviceFor(intent) ∉ rule.services
                   serviceFor: "purchase_security_scan" → "scanner"; anything else → null (rule never applies)
budget           applies if intent.amount_usd_cents >
                   (facts.task_budget_usd_cents - facts.budget_spent_usd_cents)
                   (also applies when facts.task_budget_usd_cents is null)
min_reputation   applies if facts.agent_reputation < rule.min
risk_class       applies if intent.risk_class ∈ rule.match
default          always applies

evaluate() returns DecisionResult { decision, matched_policy, matched_rule_id, reasons: [{code: rule.reason}],
  risk_score: {low:10, medium:40, high:70, critical:90}[intent.risk_class] }.
If no rule matched (missing default rule) → deny with reason "no_default_rule".
```

   The engine is a pure function: `evaluate(intent: NormalizedIntent & {tool: string}, facts: Facts, policyRules: Rule[]): DecisionResult`. No DB, no clock, no randomness inside.

7. **EXACT — `gateway/approval/provider.ts`**: `ApprovalProvider` interface `{ request(input: {decision_id, action, resource, risk_class, reason_codes}): Promise<{approval_id: string}> }`. `DevApprovalProvider` inserts an `approvals` row `{type: "ledger", provider: "dev", status: "pending"}` and returns its id. (Resolution arrives in plan-06.)

8. **EXACT — `gateway/orchestrator.ts`** sequence: ingest → normalize → facts → selectPolicy → evaluate → insert `decisions` row (`context_snapshot_hash` = sha256 of canonical JSON of facts) → emit `policy.evaluated` → then, per decision:
   - `deny` → emit `capability.denied` `{intent_id, decision_id, reason_codes}`; respond.
   - `escalate` → `ApprovalProvider.request(...)` → emit `capability.escalated` `{intent_id, decision_id, approval_id, reason_codes}`; respond.
   - `allow` → return handoff (plan-03 adds issuance; until then respond immediately).
   Response `data` is exactly the plan-00 §G tool-call shape with `capability/payment/execution = null`.

9. **Routes**: `POST /api/gateway/tool-call` (body = ToolCall, `x-cubic-agent` header overrides `agent_key`); `GET /api/audit/events?task_id=&event_type=&limit=&before_id=` (paged on `audit_events.id desc`); `GET /api/audit/trace/[taskId]` (shape exactly plan-00 §G). All use the `{ok, data|error}` envelope.

## Acceptance criteria

- [ ] Vitest table passes exactly (input via `runToolCall`, seed fixture facts, reputation injected by overriding `StaticContextProvider` with a test double):

| # | tool + arguments | reputation | expected decision / matched_rule_id / first reason code |
|---|---|---|---|
| 1 | `github.get_pull_request {repo:"acme/backend", pr:421}` | 0.95 | allow / default-allow / policy_default_allow |
| 2 | `github.delete_repo {repo:"acme/backend"}` | 0.95 | deny / tool-allowlist / tool_not_allowed |
| 3 | `github.read_file {repo:"acme/backend", path:".env.production"}` | 0.95 | deny / deny-secret-resources / secret_resource |
| 4 | `github.read_file {repo:"evil/org", path:"src/x.ts"}` | 0.95 | deny / deny-cross-task / resource_outside_task |
| 5 | `github.merge_pull_request {repo:"acme/backend", pr:421}` | 0.95 | escalate / merge-risk / risk_requires_approval |
| 6 | `github.get_pull_request {…}` | 0.50 | escalate / reputation-floor / reputation_below_threshold |
| 7 | policy with `rules: []` | 0.95 | deny / — / no_default_rule |
| 8 | `scanner.scan {target:"acme/backend#421", purchase:true, price_usd_cents:25}` budget 50, spent 0 | 0.95 | allow (payment-v1 / default-allow) |
| 9 | same as 8 but task budget 10 | 0.95 | deny / budget / budget_exceeded |

- [ ] Purity test: case 1 evaluated twice → byte-identical `DecisionResult` JSON; with `LLM_INTENT_PROVIDER` unset, no network calls occur (mock fetch and assert zero calls).
- [ ] Escalate path leaves a pending `approvals` row (`provider:"dev"`) and emits `capability.escalated`.
- [ ] `GET /api/audit/trace/[taskId]` returns the plan-00 §G shape for everything recorded so far (events ordered, chain keyed by intent).
- [ ] `curl -s -X POST localhost:3000/api/gateway/tool-call -H 'content-type: application/json' -d '{"agent_key":"agent:8472","tool":"github.get_pull_request","arguments":{"repo":"acme/backend","pr":421}}'` returns an allow decision matching case 1.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` green.

## Out of scope

Capability issuance (plan-03), execution (plan-04), real reputation source (plan-07).
