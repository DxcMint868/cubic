# Acme — demo tenant profile (all fiction, on purpose)

> Everything below is made up. Acme does not exist, `acme/backend` is not a
> real repo, PR #421 never happened. The demo mocks every external surface
> and says so on camera. What IS real: the authorization pipeline every
> fictional action passes through — normalize → policy → decision →
> capability → execution → audit. This doc exists so the demo story, script,
> and transcript all describe the same imaginary customer.

## Who Acme is

Acme is a 120-person fintech SaaS company. Their product is invoicing and
payouts for freelancers, and — like half of fintech in 2026 — they keep a
slice of their treasury onchain (USDC operating float, some ETH). Two worlds
that barely talk to each other: a GitHub-centered engineering org shipping a
monolith API several times a day, and a finance function moving serious money
through wallets and multisigs.

Acme's enterprise plan is an AI workforce across both worlds: coding agents
with merge rights, a treasury agent that rebalances and runs payroll, and
research agents with broad read access. The board approved it on one
condition — no agent touches anything without a recorded, policy-checked
authorization. That condition is why they are talking to Cubic.

## What Acme ships (the engineering side)

- **`acme/backend`** — the monolith API. PRs all day, CI on every push,
  deploys to production via Vercel. PR #421 ("Fix auth flow") is the running
  example: reviewed, CI green, approved, waiting on merge.
- A deploy pipeline where **merging and releasing are high-risk actions**:
  they require human sign-off, always have, and the AI workforce doesn't
  change that.
- A standing security-scan service (25¢ a pop on Hedera) that every PR
  passes through before merge.

## What Acme holds (the money side)

- A USDC/ETH treasury. Routine moves: rebalancing between stables and ETH,
  monthly payroll runs, staking idle USDC.
- Standing rules from the CFO: anything above ticket size escalates to a
  human; anything that looks like draining the treasury gets rejected flat.
- Real money, real irreversibility — a bad agent action here doesn't get
  reverted with `git revert`.

## The AI workforce Acme wants

| Agent (demo cast) | Job | Tools it may touch |
|---|---|---|
| deploy-agent | Ship code: read PRs, run scans, merge, deploy | github.*, deploy.production, scanner.scan, task.complete |
| treasury-agent | Move money: rebalance, payroll, stake | treasury.*, task.complete — nothing else |
| reader-agent | Research: read code and PRs, never write | github.get_pull_request, github.read_file |
| low-rep-research-agent (lab-1) | External contractor agent, new and unproven | reads only, watched closely |

## Why Acme can't just hand agents the keys (their difficulties)

Each of these is a real incident class from Acme's AI pilot, and each maps
to one demo beat:

1. **Prompt injection → secret exfiltration.** A contractor pasted "helpful
   instructions" into a ticket; the agent tried to read `.env.production`.
   Reads are cheap and usually harmless — secret reads are not. (Beat:
   `attack-env` → DENY `secret_resource`.)
2. **Runaway spend.** An agent retried a paid scan in a loop and nearly
   10x'd its 50¢ task budget. (Beat: `attack-overbudget` → DENY
   `budget_exceeded`.)
3. **Cross-task snooping.** A research agent with legitimate read access
   reached into files outside its assigned task. (Beat: `branch-cross-task`
   → DENY `resource_outside_task`.)
4. **Unproven actors.** The contractor's agent (lab-1) has live negative
   reputation. Acme doesn't ban it — it supervises it: every non-trivial
   action escalates. (Beat: `branch-low-rep` → ESCALATE
   `reputation_below_threshold`.)
5. **Self-authorized releases.** A coding agent merged and deployed without
   waiting for its human. Nothing broke; everybody aged a year. (Beats:
   `deploy-merge` / `deploy-run` → ESCALATE `risk_requires_approval`.)
6. **"Which agent did what, and who said it could?"** The audit question.
   API keys in env files can't answer it. Every incident above ended with
   the same shrug — until authorizations became first-class records.

## Why Cubic is the backbone, not a plugin

- **Deterministic policy, not vibes.** An LLM drafts what the agent wants;
   the policy engine decides ALLOW / DENY / ESCALATE. The model is never the
   authorization oracle — Acme's CISO red-lines anything else.
- **Capabilities, not keys.** No shared GitHub tokens, no wallet keys in
   agent environments. Each approval mints a scoped, 5-minute capability
   bound to the exact intent and policy version. Replay it, expire it, and
   the consume path rejects it on camera.
- **Humans in the loop where it counts.** High-risk actions escalate to
   named councils with M-of-N sign-off (deploy-council, treasury-council) —
   hardware-backed where it matters.
- **Every decision is a record.** Intent → decision → capability →
   execution → result, anchored and queryable per task. The audit question
   finally has an answer, and the network surface proves it without exposing
   tenant internals.
- **Metered tool use.** Paid services (scans, data) answer 402; the gateway
   holds the capability until budget policy says yes. Retries can't spend
   what policy hasn't approved.

## How to use this doc

- Casting: when the script needs "who is speaking," use the table above.
- Incidents: when the script needs "why does this beat exist," use §5 —
   each item names its beat id.
- Transcript voice: Acme staff talk like operators, not cryptographers.
   The gateway's vocabulary (allow/deny/escalate, capability, policy,
   trace) belongs to the product, and the demo teaches it beat by beat.
- Fiction boundary: repos, PRs, secrets, deployments, quotes, and balances
   are simulated and labeled. Agent identities (ERC-8004), decision records,
   and the authorization math are the real artifacts.
