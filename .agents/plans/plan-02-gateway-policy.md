---
guide: .agents/guides/guide-01-bootstrap.md
status: ready
depends-on: [plan-01-foundation]
---

# Plan 02 — Gateway core: ingest, intent normalization, deterministic policy

## Objective

The heart of Cubic: normalized tool-call ingest → structured intent → deterministic ALLOW / DENY / ESCALATE, with full audit events and a task-trace API.

## Preconditions

plan-01 merged; plan-00 §C/§D/§F/§G read.

## Tasks

1. **`gateway/ingest.ts`**: validate the `ToolCall` (zod: `task_id?`, `agent_key`, `tool`, `arguments`); resolve agent/tool/task/policy from the DB with structured errors for unknowns; create the `intents` row with **redacted arguments** (secret-looking values masked); emit `intent.created`.
2. **`gateway/normalize.ts`**: rules-based normalizer — maps `(tool, arguments)` → `{action, resource, risk_class}` using the tool registry plus heuristics (e.g. `github.read_file` with a `.env*` path → resource class = secret). Optional LLM assist only behind `LLM_INTENT_PROVIDER`; any LLM error or absence falls back to rules. Normalizer output feeds policy; it never decides.
3. **`gateway/context/provider.ts`**: `ContextProvider` interface, `getFacts(intent) → Facts`; `StaticContextProvider` returns `{agent_status, tool_default_risk, task_budget_usd_cents, budget_spent_usd_cents, agent_reputation: 0.95}` (reputation becomes real in plan-07).
4. **`gateway/policy/engine.ts`**: pure function `evaluate(intent, facts, policyRules) → Decision`. Rule document (jsonb, seeded in plan-01, finalized here):
   - `allow_tools` — tool allowlist per agent/task
   - `resource_rules` — deny patterns (secret paths, resources outside the task)
   - `risk_thresholds` — risk_class high|critical → ESCALATE
   - `budget_rule` — max spend per task (the payment path refines this in plan-05)
   - `reputation_rule` — min reputation for autonomous action (default 0.80; below → ESCALATE)

   Ordered, first-match-wins, precedence documented next to the code and mirrored in plan-00 §D. Every decision returns `matched_policy`, `reasons[]` (machine-readable codes, not prose), `risk_score`.
5. **`gateway/approval/provider.ts`**: `ApprovalProvider` interface + `DevApprovalProvider`: creates a pending `approvals` row on ESCALATE. Resolution endpoint arrives in plan-06; until then, escalation's terminal state is `pending` and fully traceable.
6. **`gateway/orchestrator.ts`**: `runToolCall(input)` — ingest → normalize → facts → evaluate → persist `decisions` row → emit `policy.evaluated`; on DENY emit `capability.denied`; on ESCALATE emit `capability.escalated` + create the approval; on ALLOW return a handoff object for plan-03 issuance (until then, respond with the decision only).
7. **Routes**: `POST /api/gateway/tool-call` (runs the orchestrator); `GET /api/audit/events` (paged, filters `task_id`/`event_type`); `GET /api/audit/trace/[taskId]` (task + ordered chain: intents → decisions → later capabilities/payments/executions → events).
8. **Policy tests** (table-driven vitest): allowed read → allow; unknown tool → deny; secret-path read (`.env.production`) → deny; cross-task resource → deny; high-risk tool → escalate; low reputation (fixture override) → escalate; empty policy → deny (default-deny posture).

## Acceptance criteria

- [ ] `POST /api/gateway/tool-call` with an allowed tool returns `decision:"allow"` and persists intent + decision rows with `intent.created` + `policy.evaluated` events.
- [ ] The prompt-injection fixture (`github.read_file` on `.env.production`) returns a deterministic DENY with a machine-readable reason code and a `capability.denied` event.
- [ ] A high-risk tool returns ESCALATE with a pending `approvals` row and a `capability.escalated` event.
- [ ] `GET /api/audit/trace/[taskId]` reconstructs the chain for everything recorded so far.
- [ ] The engine is pure: identical inputs → identical decision (property-style test); with `LLM_INTENT_PROVIDER` unset, no LLM code path executes.
- [ ] `pnpm typecheck` / `lint` / `test` green.

## Out of scope

Capability issuance (plan-03), execution (plan-04), payment-specific rules beyond the budget shape (plan-05), reputation source (plan-07).
