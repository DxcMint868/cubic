# Cubic build runbook (meat-proxy edition)

Two roles:

- **Orchestrator** — the main opencode session in THIS repo (`ledger-subgraph/`). Does: dispatch-prompt maintenance, branch/worktree prep, verification (`typecheck/lint/test`), merges into `main`, `MEMORY.md` updates, next-wave prep, cleanup.
- **You (meat proxy)** — hold the secrets, launch the agents, relay "done" pings. Nothing else.

## Where work happens

**Solo waves (W1, W2, W6, W7): build right here.** The orchestrator creates branch `plan-XX` off latest `main`; you run the agent in this repo directory with the branch checked out. Merge to `main` when done.

**Parallel waves (W3, W4, W5): two agents cannot share one working tree.** The orchestrator creates two temporary sibling worktrees (`../cubic-p03`, `../cubic-p08`, …) off latest `main`, runs `pnpm install` in each, copies `app/.env.local` into each (with `cp`, never reading it), and deletes them after merging.

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

1. Orchestrator preps: solo → `git checkout -b plan-XX main`; parallel → two worktrees as above.
2. You launch the agent(s) in the assigned directory and paste `.agents/dispatch/plan-XX.md` verbatim.
3. Each agent implements, ticks its ACs, commits to its branch, and ends with a final report. Solo-wave agents commit straight into their branch in this repo — never onto `main` directly.
4. You ping the orchestrator: `plan-XX done` (paste the final report if the agent isn't visible to the orchestrator).
5. Orchestrator verifies in the branch (`pnpm typecheck && pnpm lint && pnpm test`), merges into `main` (parallel waves: lower plan number first, rebases the second if needed), folds spike findings into `MEMORY.md`, deletes temp worktrees, preps the next wave.

## One-time setup

- [x] Plans + dispatch prompts committed to `main`.
- [ ] **YOU**: create `app/.env.local` in THIS repo with `DATABASE_URL` (later also `HEDERA_*`, `AGENT0_SUBGRAPH_URL` as waves need them). Never paste these into chat, never commit them.
- [ ] Orchestrator: `git checkout -b plan-01 main` → W1 launch is unblocked.

## Secrets discipline

`DATABASE_URL` / `HEDERA_OPERATOR_*` live only in `app/.env.local` (git-ignored). The orchestrator copies the file between directories with `cp` and never reads it. Agents are instructed never to print or commit it. If an agent ever asks you for a secret in chat, refuse — it goes in `.env.local` only.
