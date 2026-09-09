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

plans 05–08 merged; read `DESIGN.md` + `app/src/components/MacWindow.tsx` (reuse its `tabs/activeTab/onTabChange` API — do not recreate window chrome).

## Steps

1. **EXACT — routes and data sources** (all via `app/src/lib/api.ts` typed fetchers; client components use an SSE hook for live data):

| page | files | data source |
|---|---|---|
| `/network` | `app/src/app/network/page.tsx` + `app/src/components/network/NetworkGraph.tsx` (client) | `GET /api/network/events` (initial) + `GET /api/network/stream` (SSE live) + `GET /api/network/stats` |
| `/console` | `app/src/app/console/page.tsx` | `GET /api/audit/events` (recent) + trace links per task |
| `/console/tasks/[id]` | `app/src/app/console/tasks/[id]/page.tsx` + `components/console/TraceView.tsx` | `GET /api/audit/trace/[taskId]` |
| `/console/agents/[id]` | `app/src/app/console/agents/[id]/page.tsx` | `GET /api/audit/events?agent_id=` — if that filter doesn't exist, query trace data for the agent's tasks; do NOT edit server code for UI convenience (report the gap instead) |
| `/console/decisions/[id]` | `app/src/app/console/decisions/[id]/page.tsx` | decision detail derived from the trace endpoint (find by decision id) |

2. **EXACT — `/network` requirements:** cubes = agents (one cube per `agent_pseudonym`), grouped into clusters by `agent_category`; connections/pulses = incoming `network_events` (action_class drives the pulse type); payments (`payment.*`) render as transaction markers; denials/escalations/rejections must be visually distinct states using ONLY monochrome treatments (e.g. filled vs outlined vs dashed strokes — no color). A counters row renders the stats object. Empty state text (EXACT): `"No live events yet — run the demo agent or the swarm."` Demo-flagged swarm activity needs no special styling (it flows through the same pipeline). The graph consumes ONLY real events — remove/disable `NetworkCanvas`'s self-generated animation on any page where both would appear.

3. **EXACT — `/console/tasks/[id]` (TraceView)** renders the full chain per plan-00 §G trace shape, in order: intent (tool, resource, risk) → decision (matched_policy, matched_rule_id, reason codes) → capability (scope, expiry, nonce prefix `nonce.slice(0, 8)`, policy_hash prefix) → payments (amount, network, settlement ref) → approvals (provider, outcome) → execution (status, result_summary). DENY reasons must be immediately legible (DESIGN.md rule). Use `MacWindow` with tabs `TRACE | EVENTS`.

4. **Landing header**: point the NETWORK nav link at `/network` (surgical edit to the existing header in `page.tsx`/its component — no other landing changes).

5. **States (all pages, EXACT):** loading → skeleton frames; error → `MacWindow` with the error code + message; empty → the empty-state text pattern above.

## Acceptance criteria

- [ ] With `pnpm dev` running and a demo run in progress, `/network` shows live events arriving over SSE (verify by watching new pulses/counters while `demo/agent.ts` or the swarm runs).
- [ ] `/console/tasks/[id]` shows the complete chain for a happy-path task AND for the prompt-injection task (DENY + `secret_resource` reason visible).
- [ ] Screenshot review against DESIGN.md: monochrome only, `MacWindow` chrome reused, `.mono` for technical text — no new fonts, no color accents.
- [ ] `pnpm typecheck && pnpm lint` green; no server files modified (fence respected — any server gap was reported, not patched).

## Out of scope

Auth/multi-tenant login, landing redesign, mobile polish.
