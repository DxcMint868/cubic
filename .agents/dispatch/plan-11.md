# DISPATCH PROMPT — plan-11 (AgentGate mesh; final feature wave)

You are implementing exactly ONE plan of the Cubic MVP:
`.agents/plans/plan-11-agentgate-mesh.md`
You are already on branch `plan-11` in your assigned working directory.

CONTEXT: all waves W1–W7 are merged. This wave grafts three prize-winning traits from the AgentGate repo (prior community-vote winner, deep-dived by the orchestrator) onto Cubic: LangSmith reasoning links, a treasury demo branch, and carried UI polish. Architecture stays untouched — classification and fixtures only, no engine/schema redesign.

READ FIRST, in this order:
1. `AGENTS.md` (repo rules — includes GitNexus: impact analysis before editing symbols, detect_changes before committing; if the index is stale or errors, note it and continue, don't block on it). FIRST THING in your worktree, index it for GitNexus: `npx gitnexus analyze $(git rev-parse --show-toplevel)` — plain `npx gitnexus analyze` only works in the home repo, never inside a worktree.
2. `PROJECT.md` — skim §17 demo beats, §18 scope (treasury branch is demo fixtures + narration, not new product surface).
3. `MEMORY.md` (read-only for you).
4. `.agents/plans/plan-00-architecture.md` — shared contracts (§B.1, §F, §G). Canonical; never redefine them. Your ONE sanctioned addition: the optional `reasoning_ref` field on `NormalizedIntent` (record it as a contract addendum in your final report).
5. Your plan file — the only work you do.

FILE FENCE — you own ONLY:
- `app/src/server/reasoning/**` (new langsmith.ts)
- `app/src/server/executors/treasury.ts` (new) + its registry line
- `app/src/server/gateway/normalize.ts`: ONLY the three treasury mapping rows (nothing else)
- `app/src/server/demo/treasury.ts` (new demo script)
- `app/src/server/domain.ts`: ONLY the optional `reasoning_ref` field (nothing else)
- treasury fixture payloads inside `app/src/server/demo/seed.ts` (tools rows, allowlist append, capabilities append, treasury task — nothing else)
- `app/src/app/api/trace` consumers: TraceView reasoning-link render ONLY (no other component logic changes)
- `app/tests/treasury.test.ts` (new)
- `docs/demo.md`: treasury section ONLY
- PO polish, exactly: delete `app/src/data/agents.ts`, `app/src/data/console.ts`, `app/src/components/AgentGraph.tsx` (after verifying zero importers); unify `AUTHORIZED`→`ALLOWED` (2 files); MacWindow-wrap `AgentDetail.tsx` + `DecisionDetail.tsx`; append console URLs in `demo/agent.ts` finale + demo/run response + `docs/demo.md`
- `app/package.json`: append `langsmith` dep + `demo:treasury` script ONLY

Shared-file rules:
- `app/src/server/db/schema.ts` is frozen. Never modify it.
- `app/src/server/gateway/policy/engine.ts`: no changes — the treasury pair splits on risk_class via existing rules.
- Anything else outside your fence: STOP and report; do not edit.
- Do NOT edit `MEMORY.md` or other plans' files. Tick your plan's AC checkboxes as you verify them (your own plan file you MAY edit).

PRODUCT REVIEW (the merger runs the `product-owner` gate on your branch after you report done — pre-empt it):
- Treasury narration must read like a CIO, not a toy (notionals with teeth, reasons with rationale); dev-mode labels stay visible everywhere (`mode:"dev"`, no real funds move).
- Reasoning links real or absent — a dead/mock LangSmith URL is a PO BLOCK.
- DESIGN.md language only. Beat numbering follows PROJECT.md §17 exactly.

SELF-REVIEW (mandatory — you run your own council; this is not optional):

a. DURING the work — after each major step, not just at the end — spawn a council of 2 subagents on that step's diff: one Explorer-type (trace how the new code is/will be consumed — imports, callers, schema consumers, event shapes vs the plan-00 contracts) and one General-type, adversarial (prove the step wrong — hunt contradictions with your plan, missing literals, anything a literal executor would have to invent). Give both the plan file + the diff so far. Read both reports; fix every valid finding or rebut it in writing in your final report. (opencode: subagent_type `explore` + `general`.)
b. WHEN FINISHED — BEFORE reporting done — spawn the `contract-reviewer` subagent (repo profile `.opencode/agents/contract-reviewer.md`, invoke by name) on your branch as the final gate. If it returns BLOCK: fix every item (re-consult your council as needed) and re-run the gate until MERGE. Attach the gate verdict + a council-findings summary to your final report. Only then tick your last AC, commit, and report done.
c. If your harness cannot spawn subagents: do both reviews inline (write the for/against as working notes), execute the contract-reviewer checklist from its file manually, and state plainly in your final report that review was inline, not spawned. "No subagents" is never an excuse to skip review.

ENV: `app/.env.local` already contains `DATABASE_URL` + `HEDERA_*`. `LANGSMITH_API_KEY` is optional (absent = null path, which you must test). Never print, log, or commit env contents.

TEST DISCIPLINE: integration tests create their own throwaway tenant (slug `test-plan-11`). Never mutate the demo tenant.

DEFINITION OF DONE:
- Every AC in your plan ticked.
- `pnpm typecheck && pnpm lint && pnpm test` green.
- Repo runnable: `pnpm dev` boots; `pnpm --filter app demo:treasury` runs green.
- Commit per task: `plan-11: <task summary>`.
- Final report: what you built, AC status, deviations + why, the NormalizedIntent addendum, files touched, what the merger needs to know.
