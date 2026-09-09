# DISPATCH PROMPT — plan-06 (Wave 5, runs parallel with plan-05)

You are implementing exactly ONE plan of the Cubic MVP:
`.agents/plans/plan-06-ledger-trust.md`
You are already on branch `plan-06` in your assigned working directory. Do not switch plans, do not implement other plans' scope, do not touch main. A sibling agent is simultaneously implementing plan-05 (Hedera x402) on its own branch — stay in your fence and you will not collide.

READ FIRST, in this order:
1. `AGENTS.md` (repo rules — includes GitNexus: impact analysis before editing symbols, detect_changes before committing; if the index is stale or errors, note it and continue, don't block on it)
2. `PROJECT.md` — skim §8 Ledger role, §15 Ledger bounty requirements, §18 MVP scope
3. `MEMORY.md` (read-only for you)
4. `.agents/plans/plan-00-architecture.md` — shared contracts (§E, §F, §I Ledger boundary). Canonical; never redefine them.
5. Your plan file — the only work you do.

DO TASK 0 FIRST: install the Ledger Agent Stack wallet-cli on this machine (currently absent — verified) and verify `wallet-cli ring init` plus ring operations. Append findings as a `## Spike findings` section to YOUR plan file (do not edit `MEMORY.md` — the merger folds them in). If the environment cannot run it, mark the hardware path blocked, keep DevProvider, and say so in the docs — never claim a dev mock is hardware security.

FILE FENCE — you own ONLY:
- `app/src/server/ledger/**` (provider.ts, dev.ts, keyring.ts)
- `app/src/app/api/approvals/**` (resolve route)
- `app/src/server/gateway/orchestrator.ts`: ONLY the escalation→approval→issuance wiring. Surgical edits; never restructure the pipeline.

Shared-file rules:
- `app/src/server/db/schema.ts` is complete from plan-01. Never modify it.
- `app/package.json`: append your deps only.
- Anything else outside your fence: STOP and report; do not edit.
- Do NOT edit `MEMORY.md` or other plans' files. Tick your plan's AC checkboxes as you verify them (your own plan file you MAY edit).

ENV: `app/.env.local` contains `DATABASE_URL`; `LEDGER_PROVIDER` defaults to `dev`, `LEDGER_WALLET_CLI_PATH` optional. Never print, log, or commit env contents.

TEST DISCIPLINE: integration tests create their own throwaway tenant (slug `test-plan-06`). Keyring tests skip cleanly when wallet-cli is unavailable. Never mutate the demo tenant.

DEFINITION OF DONE:
- Every AC in your plan ticked.
- `pnpm typecheck && pnpm lint && pnpm test` green from repo root.
- Repo runnable: `pnpm dev` boots.
- Commit per task: `plan-06: <task summary>`.
- Final report (your last message): what you built, AC status, deviations + why, files touched, what the next agent needs to know.
