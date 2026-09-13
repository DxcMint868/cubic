# DISPATCH PROMPT — plan-02 (Wave 2, solo)

You are implementing exactly ONE plan of the Cubic MVP:
`.agents/plans/plan-02-gateway-policy.md`
You are already on branch `plan-02` in your assigned working directory. Do not switch plans, do not implement other plans' scope, do not touch main.

READ FIRST, in this order:
1. `AGENTS.md` (repo rules — includes GitNexus: impact analysis before editing symbols, detect_changes before committing; if the index is stale or errors, note it and continue, don't block on it)
2. `PROJECT.md` — skim §3 architecture, §5 intent handling, §18 MVP scope
3. `MEMORY.md` (read-only for you)
4. `.agents/plans/plan-00-architecture.md` — shared contracts (§E data model, §F event model, §G API routes). Canonical; never redefine them.
5. Your plan file — the only work you do.

FILE FENCE — you own ONLY:
- `app/src/server/gateway/**` (ingest, normalize, orchestrator, policy/engine, context/provider, approval/provider)
- `app/src/app/api/gateway/tool-call/**`, `app/src/app/api/audit/**`
- the policy-rule payloads inside `app/src/server/demo/seed.ts` (nothing else in that file — you finalize the rule-document shape that plan-01 stubbed)
- `app/src/server/config.ts`: you may append `DEMO_TENANT_SLUG` ONLY (plan-02 step 1); nothing else in that file

Shared-file rules:
- `app/src/server/db/schema.ts` is complete from plan-01. Never modify it.
- `app/package.json`: append your deps only.
- Anything else outside your fence: STOP and report; do not edit.
- Do NOT edit `MEMORY.md` or other plans' files. Tick your plan's AC checkboxes as you verify them (your own plan file you MAY edit).

ENV: `app/.env.local` already contains `DATABASE_URL`. Never print, log, or commit its contents.

TEST DISCIPLINE: integration tests create their own throwaway tenant (slug `test-plan-02`). Never mutate the demo tenant.

SELF-REVIEW (mandatory — you run your own council; this is not optional):

a. DURING the work — after each major step, not just at the end — spawn a council of 2 subagents on that step's diff: one Explorer-type (trace how the new code is/will be consumed — imports, callers, schema consumers, event shapes vs the plan-00 contracts) and one General-type, adversarial (prove the step wrong — hunt contradictions with your plan, missing literals, anything a literal executor would have to invent). Give both the plan file + the diff so far. Read both reports; fix every valid finding or rebut it in writing in your final report. (opencode: subagent_type `explore` + `general`.)
b. WHEN FINISHED — BEFORE reporting done — spawn the `contract-reviewer` subagent (repo profile `.opencode/agents/contract-reviewer.md`, invoke by name) on your branch as the final gate. If it returns BLOCK: fix every item (re-consult your council as needed) and re-run the gate until MERGE. Attach the gate verdict + a council-findings summary to your final report. Only then tick your last AC, commit, and report done.
c. If your harness cannot spawn subagents: do both reviews inline (write the for/against as working notes), execute the contract-reviewer checklist from its file manually, and state plainly in your final report that review was inline, not spawned. "No subagents" is never an excuse to skip review.

DEFINITION OF DONE:
- Every AC in your plan ticked.
- `pnpm typecheck && pnpm lint && pnpm test` green from repo root.
- Repo runnable: `pnpm dev` boots.
- Commit per task: `plan-02: <task summary>`.
- Final report (your last message): what you built, AC status, deviations + why, files touched, what the next agent needs to know.
