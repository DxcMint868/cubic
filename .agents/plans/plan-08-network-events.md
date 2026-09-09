---
guide: .agents/guides/guide-01-bootstrap.md
status: ready
depends-on: [plan-01-foundation, plan-02-gateway-policy]
---

# Plan 08 — Network events: privacy-minimized public projection + live stream

## Objective

The global network view consumes real gateway events — a separate allowlist projection, plus synthetic demo agents pushed through the identical pipeline.

## Preconditions

plans 01–02 merged; plan-00 §F (projection rules) read.

## Tasks

1. **`events/projection.ts`**: map `audit_events` → `network_events` rows: `{event_type → action_class, agent_pseudonym = sha256(agent_key + tenant salt), agent_category, outcome, risk_class}`. **Allowlist only** — a field not in the mapping cannot leak. Never projected: tool arguments, resource strings, prompts, policy internals, tenant identity, secrets.
2. **Bus wiring**: `emit()` projects mappable events in the same transaction as the audit append.
3. **Routes**: `GET /api/network/events` (paged, public); `GET /api/network/stream` — SSE with a replay of the last 100 events, a live tail, and a 15s heartbeat.
4. **Aggregates**: `GET /api/network/stats` — counters (agents observed, intents evaluated, allowed / denied / escalated, payments) computed from `network_events`.
5. **`demo/swarm.ts`**: synthetic agents across clusters (research, trading, defi, coding, deploy, payments) issuing real tool-calls through `runToolCall` — the real pipeline, real policy, real projection — with all rows carrying `environment=demo`. Runnable as a script or a seeded loop for the live-network feel.
6. **Tests**: projection privacy test — for every canonical event type, the projected row and the public API responses contain none of: raw arguments, resource strings, prompt text, tenant slug, secrets (canary-value assertions); SSE delivers events emitted during the test window.

## Acceptance criteria

- [ ] Every real gateway run appears in `network_events` with zero private fields (automated canary test).
- [ ] The SSE stream shows events live while the demo agent runs.
- [ ] Swarm activity flows through the actual ingest/policy pipeline and is visibly flagged demo.
- [ ] Public endpoints expose no tenant identity and no tool arguments.

## Out of scope

The visualization itself (plan-09); geographic views.
