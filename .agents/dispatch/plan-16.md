# DISPATCH PROMPT — plan-16 (UI demo flow; pre-camera micro-wave)

You are implementing exactly ONE plan of the Cubic MVP:
`.agents/plans/plan-16-ui-demo-flow.md`
You are already on branch `plan-16` in your assigned working directory.

CONTEXT: all waves W1–W7 plus plans 11–13 are merged. This wave builds the human demo surface: chat UI, scenario templates, Play mode, history filters, HCS fingerprint anchoring, and templates for already-enforced branches. Demo-surface only — the engine is frozen and stays frozen.

READ FIRST, in this order:
1. `AGENTS.md` (repo rules — includes GitNexus: impact analysis before editing symbols, detect_changes before committing; if the index is stale or errors, note it and continue, don't block on it). FIRST THING in your worktree, index it for GitNexus: `npx gitnexus analyze $(git rev-parse --show-toplevel)` — plain `npx gitnexus analyze` only works in the home repo, never inside a worktree.
2. `DESIGN.md` — **MANDATORY before any UI work**: monochrome only, `MacWindow` reuse, `.mono` technical text, Darker Grotesque, outlined-square motif, no color accents.
3. `PROJECT.md` — skim §17 demo beats (payment=Beat 4, Ledger=Beat 5), §18 scope.
4. `MEMORY.md` (read-only for you).
5. `.agents/plans/plan-00-architecture.md` — shared contracts (§B.1, §F, §G). Canonical; never redefine them.
6. Your plan file — the only work you do.

FILE FENCE — you own ONLY:
- `app/src/app/demo/chat/**` (new page + components)
- `app/src/app/api/demo/chat/**` (new route)
- `app/src/server/demo/chat.ts`, `parse.ts`, `templates.ts` (new)
- `app/src/server/anchors/**` (new hcs.ts + init-topic.ts)
- `app/src/server/events/projection.ts`: ONE anchor-hook call line ONLY
- `app/src/app/api/audit/trace/**`: derived `anchor` field ONLY (computed, never stored)
- `app/src/app/console/tasks/page.tsx`: outcome + agent filters ONLY
- `app/src/lib/api.ts`: append chat fetchers ONLY
- `app/package.json`: append `demo` chat script ONLY (no new runtime deps — MCP SDK + hash libs already present; use node:crypto server-side)
- `app/tests/demo-chat.test.ts`, `app/tests/anchors.test.ts` (new)
- `docs/demo.md`: video runbook rewrite ONLY

Shared-file rules:
- `app/src/server/db/schema.ts` is frozen. No migrations. No engine changes. No new reason codes. No new rule types. No new event types.
- Fingerprint bytes must be identical between submitter and display — single shared helper, no copies.
- Anything else outside your fence: STOP and report; do not edit.
- Do NOT edit `MEMORY.md` or other plans' files. Tick your plan's AC checkboxes as you verify them (your own plan file you MAY edit).

PRODUCT REVIEW (the merger runs the `product-owner` gate on your branch after you report done — pre-empt it):
- Every claim a judge could read must be true: mock labels intact, dev provider labeled, template buttons labeled as scenarios (never "the model figured it out"), HCS links real-or-absent.
- No overclaim sentences anywhere. When in doubt, understate.
- Beat numbering follows PROJECT.md §17 exactly.

SELF-REVIEW (mandatory — you run your own council; this is not optional):

a. DURING the work — after each major step, not just at the end — spawn a council of 2 subagents on that step's diff: one Explorer-type (trace how the new code is/will be consumed — imports, callers, schema consumers, event shapes vs the plan-00 contracts) and one General-type, adversarial (prove the step wrong — hunt contradictions with your plan, missing literals, anything a literal executor would have to invent). Give both the plan file + the diff so far. Read both reports; fix every valid finding or rebut it in writing in your final report. (opencode: subagent_type `explore` + `general`.)
b. WHEN FINISHED — BEFORE reporting done — spawn the `contract-reviewer` subagent (repo profile `.opencode/agents/contract-reviewer.md`, invoke by name) on your branch as the final gate. If it returns BLOCK: fix every item (re-consult your council as needed) and re-run the gate until MERGE. Attach the gate verdict + a council-findings summary to your final report. Only then tick your last AC, commit, and report done.
c. If your harness cannot spawn subagents: do both reviews inline (write the for/against as working notes), execute the contract-reviewer checklist from its file manually, and state plainly in your final report that review was inline, not spawned. "No subagents" is never an excuse to skip review.

ENV: `app/.env.local` already contains `DATABASE_URL` + `HEDERA_*`. `HCS_TOPIC_ID` will be absent until post-top-up topic creation — code must treat absent topic as anchor-disabled (warn once), never throw. Never print, log, or commit env contents.

TEST DISCIPLINE: integration tests create their own throwaway tenant (slug `test-plan-16`). Never mutate the demo tenant.

DEFINITION OF DONE:
- Every AC in your plan ticked.
- `pnpm typecheck && pnpm lint && pnpm test` green.
- Repo runnable: `pnpm dev` boots; chat page loads; Play runs.
- Commit per task: `plan-16: <task summary>`.
- Final report: what you built, AC status, deviations + why, files touched, what the merger needs to know.
