# DISPATCH PROMPT — plan-09 (Wave 6, solo)

You are implementing exactly ONE plan of the Cubic MVP:
`.agents/plans/plan-09-frontend.md`
You are already on branch `plan-09` in this worktree. Do not switch plans, do not implement other plans' scope, do not touch main.

READ FIRST, in this order:
1. `AGENTS.md` (repo rules — includes GitNexus: impact analysis before editing symbols, detect_changes before committing; if the index is stale or errors, note it and continue, don't block on it)
2. `DESIGN.md` — **MANDATORY before any UI work**: monochrome only, `MacWindow` reuse for panel chrome, `.mono` for technical text, Darker Grotesque for display, outlined-square motif. No color accents, no new design language.
3. `PROJECT.md` — skim §10 Global Agent Network, §17 demo narrative
4. `MEMORY.md` (read-only for you)
5. `.agents/plans/plan-00-architecture.md` — shared contracts (§G API routes, §M frontend scope). Canonical; never redefine them.
6. Your plan file — the only work you do.

FILE FENCE — you own ONLY:
- `app/src/app/network/**`, `app/src/app/console/**` (all pages)
- new components under `app/src/components/**` (network/console components — do not alter `MacWindow`, `Logo`, `TeamSection`, `DitherImage` behavior)
- `app/src/lib/api.ts` (new typed fetchers + SSE hook)
- the NETWORK nav link in the landing header (`app/src/app/page.tsx` / header component)

Shared-file rules:
- Anything in `app/src/server/**` is outside your fence: if the API shape doesn't fit the UI, STOP and report; do not edit server code.
- Do NOT edit `MEMORY.md` or other plans' files. Tick your plan's AC checkboxes as you verify them (your own plan file you MAY edit).

ENV: `app/.env.local` exists; never print, log, or commit its contents.

DATA RULES: consume real events from the API routes only — no fake/prebaked data, no self-generating animations. Synthetic swarm activity is allowed because it already flows through the real pipeline and is flagged demo.

DEFINITION OF DONE:
- Every AC in your plan ticked.
- `pnpm typecheck && pnpm lint` green from repo root (plus any tests you add).
- Repo runnable: `pnpm dev` boots; `/network` and `/console` render with live data.
- Commit per task: `plan-09: <task summary>`.
- Final report (your last message): what you built, AC status, deviations + why, files touched, what the next agent needs to know.
