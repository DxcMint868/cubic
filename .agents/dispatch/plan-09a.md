# DISPATCH PROMPT — plan-09 phase A (pre-W5; runs while plan-05 finishes)

You are implementing phase A of exactly ONE plan of the Cubic MVP:
`.agents/plans/plan-09-frontend.md`
You are already on branch `plan-09` in your assigned working directory.

CONTEXT: waves W1–W4 plus plan-06/plan-08 are merged or gated; plan-05 (Hedera x402 payments) is STILL RUNNING and NOT in your base. The payment capability row, `payments` rows, live settlement refs, and the approvals-resolve flow therefore do not exist yet. You build everything that does not depend on them (phase A). A phase-B session on this same branch finishes the payment/approval surfaces after W5 merges — leave it precise TODOs, not guesses.

READ FIRST, in this order:
1. `AGENTS.md` (repo rules — includes GitNexus: impact analysis before editing symbols, detect_changes before committing; if the index is stale or errors, note it and continue, don't block on it). FIRST THING in your worktree, index it for GitNexus: `npx gitnexus analyze $(git rev-parse --show-toplevel)` — plain `npx gitnexus analyze` only works in the home repo, never inside a worktree.
2. `DESIGN.md` — **MANDATORY before any UI work**: monochrome only, `MacWindow` reuse for panel chrome, `.mono` for technical text, Darker Grotesque for display, outlined-square motif, no color accents.
3. `PROJECT.md` — skim §10 Global Agent Network, §17 demo narrative
4. `MEMORY.md` (read-only for you)
5. `.agents/plans/plan-00-architecture.md` — shared contracts (§G API routes, §M frontend scope). Canonical; never redefine them.
6. `.agents/plans/plan-09-frontend.md` — your plan file. Phase A covers all of it EXCEPT the deferred items below.

FILE FENCE — you own ONLY:
- `app/src/app/network/**`, `app/src/app/console/**` (all pages)
- new components under `app/src/components/**` (network/console components — do not alter `MacWindow`, `Logo`, `TeamSection`, `DitherImage` behavior)
- `app/src/lib/api.ts` (new typed fetchers + SSE hook)
- the NETWORK nav link in the landing header

Shared-file rules:
- Anything in `app/src/server/**` is outside your fence: if the API shape doesn't fit the UI, STOP and report; do not edit server code.
- Do NOT edit `MEMORY.md` or other plans' files. Tick only the phase-A ACs below (your own plan file you MAY edit — tick phase-A items, leave the rest unticked).

DEFERRED TO PHASE B (do not build; leave typed TODOs):
- Payment section of TraceView (amount, network, settlement ref) — TODO comment citing the exact trace keys that will exist: `payments[]` items `{id, service, network, amount_usd_cents, status, x402_ref}` per the `payments` table + plan-00 §G payment object. Render a monochrome "Payment data lands with W5" placeholder panel in its place.
- Approvals UI (pending list, approve/reject display, approval outcome in trace) — same treatment, citing `approvals[]` items and the `ledger.approval.*` events.
- The plan-09 ACs mentioning payment refs / live paid scan — explicitly out of phase A; do not tick them.

DATA RULES: consume real events from the API routes only — no fake/prebaked data, no self-generating animations. Synthetic swarm activity is allowed because it already flows through the real pipeline and is flagged demo.

SELF-REVIEW (mandatory — you run your own council; this is not optional):

a. DURING the work — after each major step, not just at the end — spawn a council of 2 subagents on that step's diff: one Explorer-type (trace how the new code is/will be consumed — imports, callers, schema consumers, event shapes vs the plan-00 contracts) and one General-type, adversarial (prove the step wrong — hunt contradictions with your plan, missing literals, anything a literal executor would have to invent). Give both the plan file + the diff so far. Read both reports; fix every valid finding or rebut it in writing in your final report. (opencode: subagent_type `explore` + `general`.)
b. WHEN FINISHED — BEFORE reporting done — spawn the `contract-reviewer` subagent (repo profile `.opencode/agents/contract-reviewer.md`, invoke by name) on your branch as the final gate, scoped to phase-A ACs. If it returns BLOCK: fix every item (re-consult your council as needed) and re-run the gate until MERGE. Attach the gate verdict + a council-findings summary to your final report. Only then tick your last phase-A AC, commit, and report done.
c. If your harness cannot spawn subagents: do both reviews inline (write the for/against as working notes), execute the contract-reviewer checklist from its file manually, and state plainly in your final report that review was inline, not spawned. "No subagents" is never an excuse to skip review.

PRODUCT REVIEW (the merger runs the `product-owner` gate on your branch after you report done — pre-empt it):
- You serve every demo beat's *watchability*. Risk states legible in monochrome; DENY reasons visible; empty states exact.
- Binding ask from the plan-06 PO review: TraceView TODOs must include the **provider badge (`dev` vs `ledger`)**, escalation **reason codes** (not a bare badge), and the approval queue — cite the exact fields (`provider` on both approval events, `reason_codes`, `approvals[]`). A demo viewer must see which trust path ran.
- DESIGN.md language only; no invented synonyms. Demo-flagged swarm activity needs no special styling.
- Beat numbering follows PROJECT.md §17 exactly (Ledger = Beat 5, machine payment = Beat 4) anywhere you narrate.

DEFINITION OF DONE (phase A):
- `/network` live over SSE with real events; counters row; empty-state text exactly `"No live events yet — run the demo agent or the swarm."`
- `/console` overview (agents, tools, policies, tasks via audit-events grouping), `/console/tasks/[id]` full non-payment chain with DENY reasons legible, `/console/agents/[id]` + `/console/decisions/[id]` via trace gathering (no server edits).
- Payment + approval TODO placeholders typed and cited as above; zero invented shapes.
- `pnpm typecheck && pnpm lint` green (plus any tests you add).
- Commit per task: `plan-09: <task summary>`.
- Final report: what you built, phase-A AC status, the exact TODO list phase B inherits, deviations + why, files touched.
