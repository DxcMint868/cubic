# DISPATCH PROMPT — plan-01 (Wave 1, solo)

You are implementing exactly ONE plan of the Cubic MVP:
`.agents/plans/plan-01-foundation.md`
You are already on branch `plan-01` in this worktree. Do not switch plans, do not implement other plans' scope, do not touch main.

READ FIRST, in this order:
1. `AGENTS.md` (repo rules — includes GitNexus: impact analysis before editing symbols, detect_changes before committing; if the index is stale or errors, note it and continue, don't block on it)
2. `PROJECT.md` — skim §3 architecture, §5 intent handling, §18 MVP scope
3. `MEMORY.md` (read-only for you)
4. `.agents/plans/plan-00-architecture.md` — shared contracts (§E data model, §F event model, §G API routes). Canonical; never redefine them.
5. Your plan file — the only work you do.

FILE FENCE — you own ONLY:
- `app/src/server/config.ts`
- `app/src/server/db/**` (client.ts, schema.ts)
- `app/src/server/events/types.ts`, `app/src/server/events/bus.ts`
- `app/src/server/demo/seed.ts`
- `app/src/app/api/health/**`, `app/src/app/api/demo/seed/**`
- `app/package.json`, `app/drizzle.config.ts`, `app/drizzle/**` (migrations), `app/vitest.config.ts`
- root `package.json` (add the `test` script only)
- `.gitignore` (only if `.env*` is not already ignored)

You are CREATING `db/schema.ts` — it must match plan-00 §E exactly (all 13 tables, checks, uniques, indexes). Every later plan is forbidden from changing it, so get it right now.
Migrations run against the shared `DATABASE_URL` — they only create/alter tables. Seed data lives only inside the demo tenant; never global truncates.

Shared-file rules:
- `app/package.json`: append your deps only.
- Anything else outside your fence: STOP and report; do not edit.
- Do NOT edit `MEMORY.md` or other plans' files. Tick your plan's AC checkboxes as you verify them (your own plan file you MAY edit).

ENV: `app/.env.local` already contains `DATABASE_URL`. Never print, log, or commit its contents. Verify `.env*` is git-ignored before your first commit.

TEST DISCIPLINE: integration tests create their own throwaway tenant (slug `test-plan-01`). Never mutate the demo tenant.

DEFINITION OF DONE:
- Every AC in your plan ticked.
- `pnpm typecheck && pnpm lint && pnpm test` green from repo root.
- Repo runnable: `pnpm dev` boots.
- Commit per task: `plan-01: <task summary>`.
- Final report (your last message): what you built, AC status, deviations + why, files touched, what the next agent needs to know.
