# Cubic build runbook (meat-proxy edition)

Two roles:

- **Orchestrator** — the main opencode session in the MAIN repo (`ledger-subgraph/`). Does: dispatch-prompt maintenance, worktree creation, `pnpm install` per worktree, `.env.local` copying, verification (`typecheck/lint/test`), merges into `main`, `MEMORY.md` updates, next-wave prep, worktree cleanup.
- **You (meat proxy)** — hold the secrets, launch the agents, relay "done" pings. Nothing else.

## Wave map (strict order)

| Wave | Plans | Parallel? |
|---|---|---|
| W1 | plan-01 foundation | solo |
| W2 | plan-02 gateway+policy | solo |
| W3 | plan-03 capabilities ∥ plan-08 network events | 2-wide |
| W4 | plan-04 execution+MCP ∥ plan-07 Graph context | 2-wide |
| W5 | plan-05 Hedera x402 ∥ plan-06 Ledger | 2-wide |
| W6 | plan-09 frontend | solo |
| W7 | plan-10 demo+adversarial | solo |

Hard rules: never launch a wave before the previous wave is fully merged; max 2 agents at once, always in separate worktrees; one agent per plan, prompt pasted verbatim from `.agents/dispatch/plan-XX.md`. Plans contain **EXACT** blocks (verbatim code/JSON contracts) and given/when/then test tables — agents copy them, not redesign them; a plan that can't follow its EXACT blocks must stop and report.

## Per-wave loop

1. Orchestrator preps each worktree: `git worktree add ../cubic-pXX -b plan-XX main` (fresh off latest main), `pnpm install` at its root, copies `app/.env.local` from the main repo.
2. You open each worktree dir (`../cubic-pXX`) in your agent tool and paste `.agents/dispatch/plan-XX.md` verbatim. One agent per worktree; launch the wave's two agents close together.
3. Each agent implements, ticks its ACs, commits to its branch, and ends with a final report.
4. You ping the orchestrator: `plan-XX done` (paste the final report if the agent isn't visible to the orchestrator).
5. Orchestrator verifies in the worktree (`pnpm typecheck && pnpm lint && pnpm test`), merges into `main` in wave order (lower plan number first; rebases the second branch if needed), folds spike findings into `MEMORY.md`, removes the worktree, preps the next wave.

## One-time setup (already done / pending)

- [x] Plans committed to `main` (3ff6392, 6b9a44f).
- [x] Dispatch prompts: `.agents/dispatch/plan-01.md` … `plan-10.md` (+ this runbook).
- [x] W1 worktree `../cubic-p01` created + installed.
- [ ] **YOU**: create `app/.env.local` in the MAIN repo with `DATABASE_URL` (and later `HEDERA_*`, `AGENT0_SUBGRAPH_URL` as waves need them). Never paste these into chat, never commit them.
- [ ] Orchestrator copies `.env.local` into `cubic-p01` → W1 launch is unblocked.

## Secrets discipline

`DATABASE_URL` / `HEDERA_OPERATOR_*` live only in `app/.env.local` (git-ignored). The orchestrator copies the file between worktrees with `cp` and never reads it. Agents are instructed never to print or commit it. If an agent ever asks you for a secret in chat, refuse — it goes in `.env.local` only.
