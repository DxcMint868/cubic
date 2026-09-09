# DISPATCH PROMPT — plan-05 (Wave 5, runs parallel with plan-06)

You are implementing exactly ONE plan of the Cubic MVP:
`.agents/plans/plan-05-hedera-x402.md`
You are already on branch `plan-05` in your assigned working directory. Do not switch plans, do not implement other plans' scope, do not touch main. A sibling agent is simultaneously implementing plan-06 (Ledger) on its own branch — stay in your fence and you will not collide.

READ FIRST, in this order:
1. `AGENTS.md` (repo rules — includes GitNexus: impact analysis before editing symbols, detect_changes before committing; if the index is stale or errors, note it and continue, don't block on it)
2. `PROJECT.md` — skim §6 example run, §15 Hedera track requirements, §18 MVP scope
3. `MEMORY.md` (read-only for you)
4. `.agents/plans/plan-00-architecture.md` — shared contracts (§E, §F, §J Hedera boundary). Canonical; never redefine them.
5. Your plan file — the only work you do.

DO TASK 0 FIRST: the timeboxed spike against live Hedera/x402 docs to pin exact package names and the Blocky402 flow. Append findings as a `## Spike findings` section to YOUR plan file (do not edit `MEMORY.md` — the merger folds them in). Do not trust the package names written in the plan.

FILE FENCE — you own ONLY:
- `app/src/server/payments/**` (x402.ts)
- `app/src/app/api/services/scanner/**` (you take over this route from plan-04 to add the 402 gate)
- the payment policy rules inside `app/src/server/demo/seed.ts` (nothing else in that file)
- `app/src/server/gateway/orchestrator.ts`: ONLY the service.discovered and payment-decision wiring. Surgical edits; never restructure the pipeline.
- payment-flow docs (`app/README.md` section or `docs/payment-flow.md`)

Shared-file rules:
- `app/src/server/db/schema.ts` is complete from plan-01. Never modify it.
- `app/package.json`: append your deps only.
- Anything else outside your fence: STOP and report; do not edit.
- Do NOT edit `MEMORY.md` or other plans' files. Tick your plan's AC checkboxes as you verify them (your own plan file you MAY edit).

ENV: `app/.env.local` contains `DATABASE_URL` and the `HEDERA_*` vars. The payment authority (`HEDERA_OPERATOR_*`) is server-only — never exposed to agents, never in responses/event payloads, never printed. Never commit env contents. If `HEDERA_OPERATOR_*` is missing, implement everything and mark the live-settlement AC as blocked-on-env rather than faking it.

TEST DISCIPLINE: integration tests create their own throwaway tenant (slug `test-plan-05`). Network-gated tests skip cleanly without Hedera env. Never mutate the demo tenant.

DEFINITION OF DONE:
- Every AC in your plan ticked (or explicitly marked blocked-on-env).
- `pnpm typecheck && pnpm lint && pnpm test` green from repo root.
- Repo runnable: `pnpm dev` boots.
- Commit per task: `plan-05: <task summary>`.
- Final report (your last message): what you built, AC status, deviations + why, files touched, what the next agent needs to know.
