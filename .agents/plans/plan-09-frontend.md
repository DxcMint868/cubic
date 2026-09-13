---
guide: .agents/guides/guide-01-bootstrap.md
status: ready
depends-on: [plan-05-hedera-x402, plan-06-ledger-trust, plan-07-graph-context, plan-08-network-events]
---

# Plan 09 — Frontend: control plane, action trace, global network view

**HOW TO USE:** **EXACT** blocks are verbatim contracts — copy them. `DESIGN.md` is MANDATORY reading: monochrome only (black surfaces, white/gray type), `MacWindow` for panel chrome, `.mono` for technical text, Darker Grotesque for display, outlined-square motif, no color accents. Steps are ordered.

## Objective

Expose the real system: tenant control plane, full intent→result trace, decision detail, live global network. No fake data, no landing-page polish.

## Preconditions

plans 05–08 merged; read `DESIGN.md` + `app/src/components/MacWindow.tsx` FIRST (reuse its tab API — if the exported API differs from `tabs/activeTab/onTabChange`, use what the file exports and note the deviation; do not recreate window chrome).

## Steps

1. **EXACT — routes and data sources** (all via `app/src/lib/api.ts` typed fetchers; client components use an SSE hook for live data):

| page | files | data source |
|---|---|---|
| `/network` | `app/src/app/network/page.tsx` + `app/src/components/network/NetworkGraph.tsx` (client) | `GET /api/network/events` (initial) + `GET /api/network/stream` (SSE live) + `GET /api/network/stats` |
| `/console` | `app/src/app/console/page.tsx` | `GET /api/audit/events?limit=100`, grouped client-side by distinct `task_id` for "trace links per task" (no task-list route exists — grouping is the sanctioned path, deterministic) |
| `/console/tasks/[id]` | `app/src/app/console/tasks/[id]/page.tsx` + `components/console/TraceView.tsx` | `GET /api/audit/trace/[taskId]` |
| `/console/agents/[id]` | `app/src/app/console/agents/[id]/page.tsx` | PRIMARY path: gather the agent's tasks from audit events, fetch each trace, render identity + activity. There is NO `?agent_id=` filter on the audit route and you may NOT add one (out of fence) — the trace-gathering path is the spec, not a fallback. |
| `/console/decisions/[id]` | `app/src/app/console/decisions/[id]/page.tsx` | decision detail found by client-side scan of the relevant task's trace chain (match `decision.id`) |

2. **EXACT — `/network` requirements:** cubes = agents (one cube per `agent_pseudonym`), grouped into clusters by `agent_category` (reachable values: `coding, deploy, security, control` — render exactly the categories present, no others); connections/pulses = incoming `network_events` (action_class drives the pulse type); payments (`payment.*`) render as transaction markers; denials/escalations/rejections must be visually distinct states using ONLY monochrome treatments (filled vs outlined vs dashed strokes — no color). A counters row renders the stats object. Empty state text (EXACT): `"No live events yet — run the demo agent or the swarm."` The graph consumes ONLY real events — remove/disable `NetworkCanvas`'s self-generated animation on any page where both would appear.

3. **EXACT — `/console/tasks/[id]` (TraceView)** renders the full chain per plan-00 §G trace shape, in order: intent (tool, resource, risk) → decision (matched_policy, matched_rule_id, reason codes) → capability (scope, expiry, nonce prefix `nonce.slice(0, 8)`, policy_hash prefix) → payments (amount, network, settlement ref) → approvals (provider, outcome) → execution (status, result_summary). DENY reasons must be immediately legible (DESIGN.md rule). Use `MacWindow` with tabs `TRACE | EVENTS`.

4. **Landing header**: point the NETWORK nav link at `/network` (surgical edit to the existing header — no other landing changes).

5. **States (all pages, EXACT):** loading → skeleton frames; error → `MacWindow` with the error code + message; empty → the empty-state text pattern above.

## Acceptance criteria

- [x] With `pnpm dev` running and a demo run in progress, `/network` shows live events arriving over SSE (verify by watching new pulses/counters while `demo/agent.ts` or the swarm runs).
- [x] `/console/tasks/[id]` shows the complete chain for a happy-path task AND for the prompt-injection task (DENY + `secret_resource` reason visible).
- [x] Visual checklist (manual, honest): monochrome only, `MacWindow` chrome reused, `.mono` for technical text, no new fonts, no color accents — record the check in your final report. `pnpm typecheck && pnpm lint` green; no server files modified.
- [x] `pnpm typecheck && pnpm lint` green.

## Out of scope

Auth/multi-tenant login, landing redesign, mobile polish.
