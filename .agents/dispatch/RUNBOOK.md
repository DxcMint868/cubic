# Cubic build runbook (meat-proxy edition)

Two roles:

- **Orchestrator** — the main opencode session in THIS repo (`ledger-subgraph/`). Does: dispatch-prompt maintenance, branch/worktree prep, verification (`typecheck/lint/test`), merges into `main`, `MEMORY.md` updates, next-wave prep, cleanup.
- **You (meat proxy)** — hold the secrets, launch the agents, relay "done" pings. Nothing else.

## Where work happens

Every active plan gets its own directory — agents never run in the orchestrator's home repo. The orchestrator creates a sibling worktree per plan (`../cubic-p01`, `../cubic-p03`, …) off latest `main` on branch `plan-XX`, runs `pnpm install` in it, and copies `app/.env.local` into it (with `cp`, never reading it). Solo waves: one worktree. Parallel waves (W3, W4, W5): two worktrees. Worktrees are deleted after their wave merges. Home-repo `main` stays pristine — merges only.

## Wave map (strict order)

| Wave | Plans | Where |
|---|---|---|
| W1 | plan-01 foundation | solo, here |
| W2 | plan-02 gateway+policy | solo, here |
| W3 | plan-03 capabilities ∥ plan-08 network events | 2-wide, `../cubic-p03` + `../cubic-p08` |
| W4 | plan-04 execution+MCP ∥ plan-07 Graph context | 2-wide, `../cubic-p04` + `../cubic-p07` |
| W5 | plan-05 Hedera x402 ∥ plan-06 Ledger | 2-wide, `../cubic-p05` + `../cubic-p06` |
| W6 | plan-09 frontend | solo, here |
| W7 | plan-10 demo+adversarial | solo, here |

Hard rules: never launch a wave before the previous wave is fully merged; max 2 agents at once, always in separate directories; one agent per plan, prompt pasted verbatim from `.agents/dispatch/plan-XX.md`. Plans contain **EXACT** blocks (verbatim code/JSON contracts) and given/when/then test tables — agents copy them, not redesign them; a plan that can't follow its EXACT blocks must stop and report.

## Per-wave loop

1. Orchestrator preps each worktree: `git worktree add ../cubic-pXX -b plan-XX main` (fresh off latest main), `pnpm install` at its root, copies `app/.env.local` from the home repo.
2. You open each worktree dir (`../cubic-pXX`) in your agent tool and paste `.agents/dispatch/plan-XX.md` verbatim. One agent per worktree; launch a wave's two agents close together.
3. Each agent implements, ticks its ACs, commits to its branch, and ends with a final report. Agents commit inside their own worktree — never onto `main` directly.
4. You ping the orchestrator: `plan-XX done` (paste the final report if the agent isn't visible to the orchestrator).
5. Orchestrator verifies in the branch (`pnpm typecheck && pnpm lint && pnpm test`), merges into `main` (parallel waves: lower plan number first, rebases the second if needed), folds spike findings into `MEMORY.md`, deletes temp worktrees, preps the next wave.

## One-time setup

- [x] Plans + dispatch prompts committed to `main`.
- [x] `app/.env.local` in the home repo holds `DATABASE_URL` (later also `HEDERA_*`, `AGENT0_SUBGRAPH_URL` as waves need them — you add them there, orchestrator copies outward).
- [x] W1 worktree `../cubic-p01` on branch `plan-01`: installed + env copied → launch is unblocked (see below).

## Secrets discipline

`DATABASE_URL` / `HEDERA_OPERATOR_*` live only in `app/.env.local` (git-ignored). The orchestrator copies the file between directories with `cp` and never reads it. Agents are instructed never to print or commit it. If an agent ever asks you for a secret in chat, refuse — it goes in `.env.local` only.
