# DISPATCH PROMPT — plan-10 (Wave 7, solo, FINAL agent)

You are implementing exactly ONE plan of the Cubic MVP:
`.agents/plans/plan-10-demo-adversarial.md`
You are already on branch `plan-10` in your assigned working directory. Do not switch plans, do not implement other plans' scope, do not touch main. You are the last agent in the build sequence — everything else is merged.

READ FIRST, in this order:
1. `AGENTS.md` (repo rules — includes GitNexus: impact analysis before editing symbols, detect_changes before committing; if the index is stale or errors, note it and continue, don't block on it). FIRST THING in your worktree, index it for GitNexus: `npx gitnexus analyze $(git rev-parse --show-toplevel)` — plain `npx gitnexus analyze` only works in the home repo, never inside a worktree.
2. `PROJECT.md` — §17 demo narrative (your beats), §18 MVP scope
3. `MEMORY.md` (read-only until your final task)
4. `.agents/plans/plan-00-architecture.md` — §C runtime flow, §D failure flows, §N demo sequence. Canonical.
5. Your plan file — the only work you do.
6. The `## Spike findings` sections in plan-05/plan-06 files (merged into main) — they contain the pinned x402 and wallet-cli facts your demo depends on.

FILE FENCE — you own ONLY:
- `app/src/server/demo/agent.ts` (new scripted agent)
- `app/src/app/api/demo/run/**` (optional convenience route)
- `app/tests/e2e.demo.test.ts` (new)
- `docs/demo.md` (new)
- EXCEPTION — as your FINAL task (task 6), you MAY append the final implementation-state entry to `MEMORY.md`. You are the only agent allowed to touch it.

Shared-file rules:
- `app/src/server/db/schema.ts` is complete. Never modify it.
- Anything else outside your fence: STOP and report; do not edit.
- Tick your plan's AC checkboxes as you verify them (your own plan file you MAY edit).

ENV: `app/.env.local` contains `DATABASE_URL` and `HEDERA_*`. Never print, log, or commit env contents. If Hedera env is absent, the network-gated parts of the e2e smoke skip cleanly — never fake a settlement.

SELF-REVIEW (mandatory — you run your own council; this is not optional):

a. DURING the work — after each major step, not just at the end — spawn a council of 2 subagents on that step's diff: one Explorer-type (trace how the new code is/will be consumed — imports, callers, schema consumers, event shapes vs the plan-00 contracts) and one General-type, adversarial (prove the step wrong — hunt contradictions with your plan, missing literals, anything a literal executor would have to invent). Give both the plan file + the diff so far. Read both reports; fix every valid finding or rebut it in writing in your final report. (opencode: subagent_type `explore` + `general`.)
b. WHEN FINISHED — BEFORE reporting done — spawn the `contract-reviewer` subagent (repo profile `.opencode/agents/contract-reviewer.md`, invoke by name) on your branch as the final gate. If it returns BLOCK: fix every item (re-consult your council as needed) and re-run the gate until MERGE. Attach the gate verdict + a council-findings summary to your final report. Only then tick your last AC, commit, and report done.
c. If your harness cannot spawn subagents: do both reviews inline (write the for/against as working notes), execute the contract-reviewer checklist from its file manually, and state plainly in your final report that review was inline, not spawned. "No subagents" is never an excuse to skip review.

PRODUCT REVIEW (the merger runs the `product-owner` gate on your branch after you report done — pre-empt it, and expect it to be strict: this wave IS the demo):
- Beat numbering follows PROJECT.md §17 exactly (machine payment = Beat 4, Ledger = Beat 5).
- Narration frames the approval resolve as the dev stand-in ("on hardware this is the Ledger approval; the event chain is identical"); use `resolve-approvals.ts` deliberately, never as an unseen auto-approver mid-story.
- No faked beats: skipped/blocked steps are narrated as blocked, never mimed. PO BLOCKs on theater.

DEFINITION OF DONE:
- Every AC in your plan ticked.
- `pnpm typecheck && pnpm lint && pnpm test` green from repo root.
- Repo runnable: `pnpm dev` boots; `pnpm --filter app demo` executes the happy path (env permitting) and prints the trace URL.
- Commit per task: `plan-10: <task summary>`.
- Final report (your last message): what you built, AC status, deviations + why, files touched, the exact demo command sequence for the video.
