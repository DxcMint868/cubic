---
guide: .agents/guides/guide-01-bootstrap.md
status: ready
depends-on: [plan-05-hedera-x402, plan-06-ledger-trust, plan-07-graph-context, plan-08-network-events]
---

# Plan 09 — Frontend: control plane, action trace, global network view

## Objective

Expose the real system: the tenant control plane, the full intent→result trace, decision detail, and the live global network — no landing-page polish, no fake data.

## Preconditions

plans 05–08 merged (trace / payments / approvals / network events exist). **Read `DESIGN.md` first** — monochrome, `.mono`, `MacWindow` reuse, Darker Grotesque; cubes metaphor per plan-00 §M.

## Tasks

1. **`/network`** (`app/src/app/network/page.tsx` + `components/network/NetworkGraph.tsx`): event-driven graph — agents = cubes, clusters = cube groups, actions = connection pulses, payments = transaction markers, denials/escalations = distinct monochrome states (e.g. outlined vs filled vs dashed). Live SSE tail via `GET /api/network/stream`; counters row from the stats endpoint; demo activity labeled. Extend or replace `NetworkCanvas` — the canvas must consume real events, never self-generate.
2. **`/console`** (`app/src/app/console/page.tsx`): tenant overview — agents, tools, policies, tasks, pending approvals. Read-first (edit only where trivially cheap).
3. **`/console/tasks/[id]`** (+ `TraceView` component): the full chain from `/api/audit/trace/[taskId]` — intent, decision + reasons, capability (scope/expiry/nonce), payment (amount/network/refs), approval state, execution result. MacWindow chrome; risk states immediately legible per `DESIGN.md`.
4. **`/console/agents/[id]`**: identity, ERC-8004 ref, reputation (graph badge), declared capabilities, recent activity.
5. **`/console/decisions/[id]`**: matched policy, reason codes, context facts, snapshot hash, approval linkage.
6. **Shared client data layer**: small typed fetchers (`app/src/lib/api.ts`) + an SSE hook; server components for initial data, client components for live parts.
7. **Landing header**: point the placeholder NETWORK nav link at `/network`.

## Acceptance criteria

- [ ] `/network` shows live events from a concurrent demo run (swarm or scripted agent) — not prebaked, not self-animated.
- [ ] `/console/tasks/[id]` renders the complete chain, including DENY reasons for the prompt-injection fixture and payment refs for the paid scan.
- [ ] Monochrome-only per `DESIGN.md`; `MacWindow` reused for panels; `.mono` for technical text; `pnpm typecheck` / `lint` clean.
- [ ] No console auth (out of scope), but the demo-tenant-only assumption is visible in the UI footer.

## Out of scope

Auth / multi-tenant login, landing-page redesign, mobile polish.
