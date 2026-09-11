---
guide: .agents/guides/guide-01-bootstrap.md
status: ready
depends-on: [plan-01-foundation, plan-02-gateway-policy]
---

# Plan 08 — Network events: privacy-minimized public projection + live stream

**HOW TO USE:** **EXACT** blocks are verbatim contracts — copy them as written. Steps are ordered.

## Objective

The global network view consumes real gateway events — a separate allowlist projection, plus synthetic demo agents pushed through the identical pipeline.

## Preconditions

plans 01–02 merged; plan-00 §F (payload fields + projection rules) read.

## Steps

1. **EXACT — `events/projection.ts`** mapping (event_type → `action_class`, `outcome`). Only these event types project; anything else is skipped:

```text
intent.created             → action_class "intent",       outcome "created"
policy.evaluated           → "evaluation",   outcome = payload.decision (allow|deny|escalate)
capability.issued          → "authorization", outcome "issued"
capability.denied          → "authorization", outcome "denied"
capability.escalated       → "authorization", outcome "escalated"
capability.consumed        → "authorization", outcome "consumed"
capability.rejected        → "authorization", outcome = payload.reason
ledger.approval.requested  → "approval",     outcome "requested"
ledger.approval.completed  → "approval",     outcome = payload.outcome
payment.requested          → "payment",     outcome "requested"
payment.completed          → "payment",     outcome "completed"
payment.failed             → "payment",     outcome "failed"
service.discovered         → "discovery",   outcome "discovered"
tool.execution.started     → "execution",   outcome "started"
tool.execution.completed   → "execution",   outcome "succeeded"
tool.execution.failed      → "execution",   outcome "failed"
task.completed             → "task",         outcome = payload.status
```

2. **EXACT — field resolution order** (projection runs inside `emit()`, which only receives the envelope + best-effort `meta`):
   - `agent_key` = `meta.agent_key` → else `SELECT agent_key FROM agents WHERE id = envelope.agent_id` → else skip projection (no row).
   - `agent_pseudonym` = `sha256(agent_key + "|cubic-network-v1").hexdigest.slice(0, 16)` (node:crypto).
   - causal intent: `payload.intent_id` if present → else `capability_id` → `capabilities.decision_id` → `decisions.intent_id` → `intents`; else `approval_id` → `approvals.decision_id` → `decisions.intent_id`; else `execution_id` → `executions.capability_id` → (as capability); else `payment_id` → `payments.capability_id` → (as capability); else none.
   - `agent_category` = `meta.category` → else the intent's tool row `category` → else `"control"`.
   - `risk_class` = `meta.risk_class` → else the intent's `risk_class` → else `"low"`.
   - Nothing else is written — allowlist only; tool arguments, resource strings, prompts, tenant identity, and policy internals are NEVER projected. Orchestrator call sites SHOULD pass `meta` (`agent_key`, tool `category`, intent `risk_class`) where already known.

3. **EXACT — routes:**
   - `GET /api/network/events?limit=&before_id=` — paged `network_events` newest-first: `{ok:true, data:{events:[{id, event_type, agent_pseudonym, agent_category, action_class, outcome, risk_class, created_at}]}}`.
   - `GET /api/network/stream` — SSE, `Content-Type: text/event-stream`: first the last 100 events as `event: network\ndata: {…same row shape…}\n\n` (oldest first), then live tail, plus a `: ping\n\n` comment heartbeat every 15s. On disconnect, clean up (no leaked timers).
   - `GET /api/network/stats` — `{ok:true, data:{agents_observed, intents_evaluated, allowed, denied, escalated, payments_completed}}` — all COUNTs over `network_events` (GROUP BY outcome/action_class).

4. **EXACT — `demo/swarm.ts`**: 8 synthetic agents (`agent:swarm-1` … `agent:swarm-8`) spread over the REACHABLE clusters `coding, deploy, security, control` (2 agents each — these are the seeded tool categories, so clusters actually occur). Before looping, upsert idempotently into the demo tenant per agent: an `agents` row (`environment:"demo"`, `status:"active"`, `declared_capabilities: ["github.get_pull_request","github.read_file","scanner.scan"]`) + one open `tasks` row (budget 50). Then loop a small scripted set of real `runToolCall` invocations (allowed reads + one `.env` read attempt each) at random 1–5s intervals. Runs via `pnpm --filter app swarm` (tsx). All swarm agents pass through the real ingest → policy → projection pipeline — no synthetic event injection.

## Acceptance criteria

- [x] **Privacy canary test:** emit `intent.created` whose redacted arguments contain `"CANARY-t0k3n"` and whose agent_key contains `"agent:canary"` → the `network_events` row and all three public routes contain neither `"CANARY"` nor `"agent:canary"` (assert over raw JSON strings).
- [x] Projection coverage: for every mapped event type in step 1, emitting it produces exactly one `network_events` row with the exact `action_class`/`outcome` from the table.
- [x] SSE test: subscribe, emit 3 events, assert they arrive in order; heartbeat does not break parsing.
- [x] Swarm: run briefly → swarm activity appears in `audit_events` AND `network_events` (proving the real pipeline), all swarm rows traceable to `environment:"demo"` agents.
- [x] `pnpm typecheck && pnpm lint && pnpm test` green.

## Out of scope

The visualization itself (plan-09); geographic views.
