# DISPATCH PROMPT — plan-04 (Wave 4, runs parallel with plan-07)

You are implementing exactly ONE plan of the Cubic MVP:
`.agents/plans/plan-04-execution-mcp.md`
You are already on branch `plan-04` in your assigned working directory. Do not switch plans, do not implement other plans' scope, do not touch main. A sibling agent is simultaneously implementing plan-07 (Graph context) on its own branch — stay in your fence and you will not collide.

READ FIRST, in this order:
1. `AGENTS.md` (repo rules — includes GitNexus: impact analysis before editing symbols, detect_changes before committing; if the index is stale or errors, note it and continue, don't block on it)
2. `PROJECT.md` — skim §3 architecture, §5 intent handling, §18 MVP scope
3. `MEMORY.md` (read-only for you)
4. `.agents/plans/plan-00-architecture.md` — shared contracts (§E, §F, §G API routes, §H MCP boundary). Canonical; never redefine them.
5. Your plan file — the only work you do.

FILE FENCE — you own ONLY:
- `app/src/server/executors/**` (registry, github, securityScan)
- `app/src/server/mcp/**` (server.ts)
- `app/src/app/api/services/scanner/**`, `app/src/app/api/mcp/**`
- `app/src/server/gateway/orchestrator.ts`: ONLY the execution phase and task-completion wiring. Surgical edits; never restructure the pipeline.
- `app/package.json`: add `@modelcontextprotocol/sdk` (plus your install).

Shared-file rules:
- `app/src/server/db/schema.ts` is complete from plan-01. Never modify it.
- Anything else outside your fence: STOP and report; do not edit.
- Do NOT edit `MEMORY.md` or other plans' files. Tick your plan's AC checkboxes as you verify them (your own plan file you MAY edit).

ENV: `app/.env.local` already contains `DATABASE_URL`. Never print, log, or commit its contents.

TEST DISCIPLINE: integration tests create their own throwaway tenant (slug `test-plan-04`). Never mutate the demo tenant.

DEFINITION OF DONE:
- Every AC in your plan ticked.
- `pnpm typecheck && pnpm lint && pnpm test` green from repo root.
- Repo runnable: `pnpm dev` boots.
- Commit per task: `plan-04: <task summary>`.
- Final report (your last message): what you built, AC status, deviations + why, files touched, what the next agent needs to know.
