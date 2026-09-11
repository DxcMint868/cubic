---
guide: .agents/guides/guide-01-bootstrap.md
status: ready
depends-on: [plan-01-foundation]
---

# Plan 02 — Gateway core: ingest, intent normalization, deterministic policy

**HOW TO USE:** **EXACT** blocks are verbatim contracts — copy them as written. If an EXACT block fails, STOP and report; never silently redesign. Steps are ordered.

## Objective

The heart of Cubic: `ToolCall` ingest → structured intent → deterministic ALLOW/DENY/ESCALATE, with full audit events and a task-trace API. The LLM (optional, env-gated) may only help normalize; the policy engine is pure and deterministic.

## Preconditions

plan-01 merged; plan-00 §B.1/§F/§G read (domain types, event payload fields, response envelope).

## Steps

1. **EXACT — `gateway/ingest.ts`**: `ingest(input: ToolCall & { origin?: "agent" | "payment_discovery" })`:
   - Parse body as `ToolCall` (zod; fail → `INVALID_REQUEST`).
   - Tenant: `tenants` row where `slug = config().DEMO_TENANT_SLUG` → missing: `INTERNAL` "demo tenant missing". (You append `DEMO_TENANT_SLUG: z.string().default("demo")` to `config.ts` — the single sanctioned exception to plan-01's ownership of that file — and replace the `"demo"` literal in `demo/seed.ts` with it.)
   - Agent by `(tenant, agent_key)` → `AGENT_NOT_FOUND`.
   - Tool row: if present, continue; if **absent, do NOT 404** — fall through to the normalize fallback in step 2 (an unknown tool must reach policy and die on `tool-allowlist`, per AC row 2).
   - Task: body `task_id` → else `x-cubic-task` header → else agent's latest `open` task → none: `TASK_NOT_FOUND`.
   - **Redaction (EXACT):** recursively walk `arguments` (plain objects up to depth 3, arrays mapped); any key matching `/token|secret|password|credential|private_key/i` has its value replaced with `"[REDACTED]"`. Persist the result to `intents.arguments_redacted`.
   - Insert `intents` row (`risk_class` initially from the tool row, or `"medium"` when the tool is unknown; `origin` = input origin, default `"agent"`).
   - Emit `intent.created` `{intent_id, tool, resource: null, risk_class, origin}`.

2. **EXACT — `gateway/normalize.ts`** mapping (pure; unknown tools fall through to the last row):

```text
github.get_pull_request   → action "get_pull_request",      resource `${args.repo}#${args.pr}`,  risk low
github.read_file          → action "read_file",             resource `${args.repo}/${args.path}`, risk low
github.merge_pull_request  → action "merge_pull_request",    resource `${args.repo}#${args.pr}`,  risk high
deploy.production         → action "deploy_production",     resource `${args.repo}`,              risk critical
scanner.scan  (args.purchase !== true) → action "scan",     resource `${args.target}`,           risk medium
scanner.scan  (args.purchase === true) → action "purchase_security_scan", resource `${args.target}`,
                                          risk medium, amount_usd_cents = args.price_usd_cents
task.complete             → action "task_complete",         resource = task_id,                  risk low
<any other tool>          → action = the raw tool name,     resource = the raw tool name,        risk medium

resource_class:
  "secret"     if tool == "github.read_file" && String(args.path).startsWith(".env")
  "cross_task" if args.repo is defined && args.repo !== "acme/backend"   // demo task repo literal
  "normal"     otherwise
```

   After normalizing, UPDATE the intent row (`normalized`, `resource`, `risk_class`).
   Optional LLM assist **only** behind `LLM_INTENT_PROVIDER`; any error or unset env → the rules above are the output. With the env unset, zero LLM code executes.

3. **EXACT — facts builder** (`gateway/context/provider.ts`): `StaticContextProvider.getFacts(intent, ctx)` returns `{ agent_status: <agents.status>, agent_reputation: 0.95, tool_default_risk: <tools.default_risk_class, or "medium" when the tool row is absent>, task_budget_usd_cents: <tasks.budget_usd_cents>, budget_spent_usd_cents: <EXACT query below> }`:

```ts
import { sql } from "drizzle-orm";
const spent = await db().select({ s: sql<number>`coalesce(sum(${payments.amountUsdCents}),0)` })
  .from(payments)
  .innerJoin(capabilities, eq(payments.capabilityId, capabilities.id))
  .innerJoin(decisions, eq(capabilities.decisionId, decisions.id))
  .innerJoin(intents, eq(decisions.intentId, intents.id))
  .where(and(eq(intents.taskId, taskId), eq(payments.status, "completed")));
```

   plan-07 replaces only the reputation source; the `Facts` shape does not change.

4. **EXACT — policy rule documents.** Replace the three stub policy `rules` in `demo/seed.ts` with exactly these JSON documents (unchanged from the previous version of this plan — `default-v1`, `payment-v1`, `production-merge-v1` with `deny-secret-resources`, `deny-cross-task`, `tool-allowlist` incl. `task.complete`, `reputation-floor` 0.80, `risk-approval`, `service-allowlist: ["scanner"]`, `budget`, `merge-only`, `merge-reputation` 0.90, `merge-risk`, `default-allow`/`default-deny`).

5. **EXACT — policy selection** (exported from `gateway/policy/engine.ts` as `selectPolicy`):

```text
selectPolicy(intent):
  if intent.amount_usd_cents != null → "payment-v1"
  else if intent.action == "merge_pull_request" → "production-merge-v1"
  else → "default-v1"
```

6. **EXACT — `gateway/policy/engine.ts`** (export `evaluate`, `selectPolicy`, `serviceFor`):

```text
serviceFor(intent): "purchase_security_scan" → "scanner"; anything else → null (service_allowlist never applies)

rule semantics, evaluated in array order, first match wins:
  resource_class    applies if intent.resource_class ∈ rule.match
  tool_allowlist    applies if intent.tool ∉ rule.tools
  service_allowlist applies if serviceFor(intent) ∉ rule.services
  budget            applies if intent.amount_usd_cents >
                      (facts.task_budget_usd_cents - facts.budget_spent_usd_cents)
                      (also applies when facts.task_budget_usd_cents is null)
  min_reputation    applies if facts.agent_reputation < rule.min
  risk_class        applies if intent.risk_class ∈ rule.match
  default           always applies

evaluate(intent: NormalizedIntent, facts: Facts, policyRules: Rule[]): DecisionResult
  — pure: no DB, no clock, no randomness.
  — returns { decision, matched_policy, matched_rule_id, reasons: [{code: rule.reason}],
      risk_score: {low:10, medium:40, high:70, critical:90}[intent.risk_class] }.
  — if no rule matched (missing default): deny, matched_rule_id = "no_default_rule",
      reasons = [{code: "no_default_rule"}].
```

7. **EXACT — `gateway/approval/provider.ts`**: `ApprovalProvider` interface `{ request(input: {decision_id, action, resource, risk_class, reason_codes}): Promise<{approval_id: string}> }`. `DevApprovalProvider` inserts `approvals {type:"ledger", provider:"dev", status:"pending"}` and returns its id. (This is the canonical dev provider — plan-06 does NOT duplicate it; plan-06 adds the Ledger implementation of the same interface.) Resolution endpoint arrives in plan-06; until then escalation's terminal state is `pending`.

8. **EXACT — `gateway/orchestrator.ts`**: export `runToolCall(input: ToolCall): Promise<{ok:true; data: ToolCallData} | {ok:false; error:{code: ApiErrorCode; message: string}}>` where `ToolCallData` is the plan-00 §G shape (stages `capability/payment/execution/payment_required` are `null` until their plans land). Sequence: ingest → normalize → facts → selectPolicy → evaluate → insert `decisions` row (`matched_rule_id` included; `context_snapshot_hash` = sha256 of plan-03's `canonicalize(facts)`, with `null` fields kept as `null`) → emit `policy.evaluated` → then:
   - `deny` → emit `capability.denied` `{intent_id, decision_id, reason_codes}`; respond.
   - `escalate` → `ApprovalProvider.request(...)` → emit `capability.escalated` `{intent_id, decision_id, approval_id, reason_codes}` → emit `ledger.approval.requested` `{approval_id, decision_id, provider: config().LEDGER_PROVIDER, action, resource}`; respond with `approval_id` set.
   - `allow` → return handoff (plan-03 adds issuance; until then respond immediately).

9. **Routes**: `POST /api/gateway/tool-call` (body = ToolCall; `x-cubic-agent` header overrides `agent_key`); `GET /api/audit/events?task_id=&event_type=&limit=&before_id=` (paged on `audit_events.id` desc); `GET /api/audit/trace/[taskId]` (exact plan-00 §G shape). All use the `{ok, data|error}` envelope.

## Acceptance criteria

- [x] Vitest table passes exactly (via `runToolCall`, seed fixtures, reputation injected by overriding `StaticContextProvider` with a test double; empty-rules test calls `evaluate()` directly with `rules: []`):

| # | tool + arguments | reputation | expected decision / matched_rule_id / first reason code |
|---|---|---|---|
| 1 | `github.get_pull_request {repo:"acme/backend", pr:421}` | 0.95 | allow / default-allow / policy_default_allow |
| 2 | `github.delete_repo {repo:"acme/backend"}` | 0.95 | deny / tool-allowlist / tool_not_allowed (via the unknown-tool fallback, NOT a 4xx) |
| 3 | `github.read_file {repo:"acme/backend", path:".env.production"}` | 0.95 | deny / deny-secret-resources / secret_resource |
| 4 | `github.read_file {repo:"evil/org", path:"src/x.ts"}` | 0.95 | deny / deny-cross-task / resource_outside_task |
| 5 | `github.merge_pull_request {repo:"acme/backend", pr:421}` | 0.95 | escalate / merge-risk / risk_requires_approval |
| 6 | `github.get_pull_request {…}` | 0.50 | escalate / reputation-floor / reputation_below_threshold |
| 7 | `evaluate(…, rules: [])` | 0.95 | deny / no_default_rule / no_default_rule |
| 8 | `scanner.scan {target:"acme/backend#421", purchase:true, price_usd_cents:25}` budget 50, spent 0 | 0.95 | allow (payment-v1 / default-allow) |
| 9 | same as 8 but task budget 10 | 0.95 | deny / budget / budget_exceeded |

- [x] Purity test: case 1 twice → byte-identical `DecisionResult` JSON; with `LLM_INTENT_PROVIDER` unset, no network calls (mock fetch, assert zero calls).
- [x] Escalate path leaves a pending `approvals` row (`provider:"dev"`) and emits BOTH `capability.escalated` AND `ledger.approval.requested`.
- [x] `GET /api/audit/trace/[taskId]` returns the plan-00 §G shape; every `decision` object in `chain` includes `matched_rule_id` (read from the `decisions` row).
- [x] `curl -s -X POST localhost:3000/api/gateway/tool-call -H 'content-type: application/json' -d '{"agent_key":"agent:8472","tool":"github.get_pull_request","arguments":{"repo":"acme/backend","pr":421}}'` returns case-1 allow; the `.env.production` variant returns case-3 deny.
- [x] `pnpm typecheck && pnpm lint && pnpm test` green.

## Out of scope

Capability issuance (plan-03), execution (plan-04), real reputation source (plan-07).
