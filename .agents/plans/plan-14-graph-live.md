---
guide: .agents/guides/guide-01-bootstrap.md
status: ready
depends-on: [plan-07-graph-context]
---

# Plan 14 — Real Agent0 data: kill the fixture, read live reputation

**HOW TO USE:** **EXACT** blocks are verbatim contracts — copy them as written. If an EXACT block fails, STOP and report; never silently redesign. Steps are ordered. Context: plan-07 shipped the pipeline against a fixture identity; this wave graduates it to live public data. No engine/policy/schema changes.

## Objective

The reputation fact that drives policy comes from The Graph's real Agent0 index — a real agent, real scores, live on camera — with the fixture demoted to labeled offline fallback.

## Preconditions

plan-12 merged. Read `.agents/plans/plan-00-architecture.md` (§B.1, §K), `app/src/server/graph/agent0.ts` (current query + fixture map).

## Steps

1. **EXACT — endpoint construction (no user-facing URL assembly):**
   - `config.ts`: add `THEGRAPH_API_KEY: z.string().min(1).optional()` (append-only exception to plan-01's file).
   - `graph/agent0.ts`: default Base Mainnet deployment when `AGENT0_SUBGRAPH_URL` is unset:
     ```ts
     const DEFAULT_SUBGRAPH_ID = "43s9hQRurMGjuYnC1r2ZwS6xSQktbFyXMPMqGKUFJojb"; // Agent0 Base Mainnet (agent0lab/subgraph)
     function endpoint(): string {
       if (config().AGENT0_SUBGRAPH_URL) return config().AGENT0_SUBGRAPH_URL;
       const key = config().THEGRAPH_API_KEY;
       if (!key) throw new Error("agent0: set AGENT0_SUBGRAPH_URL or THEGRAPH_API_KEY");
       return `https://gateway.thegraph.com/api/${key}/subgraphs/id/${DEFAULT_SUBGRAPH_ID}`;
     }
     ```
   - Stated plainly in code comment: Hedera has no ERC-8004 contracts deployed (Agent0 table), so reputation is read where it lives (Base) and enforced where we operate (Hedera testnet) — cross-chain trust context, not a gap.

2. **EXACT — schema verification against the LIVE endpoint** (do not trust the plan-07 comments): run the current `AGENT0_QUERY` verbatim against the default endpoint with a known agent id. Known drift risk: deployed Feedback exposes `score`, not `value` (Agent0 README schema). If the live schema differs, adapt the query + zod + reputation mapping minimally and record the diff in your final report. The query must return rows before proceeding — no guessing.

3. **EXACT — find the demo identities** (live queries only):
   - One agent WITH real non-revoked feedback (any score): becomes the allow-path demo identity.
   - The LOWEST-scored agent with real feedback you can find: becomes the escalate-path demo identity (replaces `fixture:low-rep` on camera).
   - Record both ids (`"<chainId>:<agentId>"` form), their scores, and the exact queries used in your final report. If no low-score agent exists anywhere reachable, say so explicitly and keep the fixture for that beat (labeled) — do not manufacture on-chain feedback to rig a score. Ever.

4. **EXACT — flip the demo (fixture stays as fallback):**
   - Seed: add the two real identities as demo agents (keep `agent:lab-1`/`fixture:low-rep` rows untouched — offline fallback).
   - Demo script: point the reputation beats at the real identities; narration states the scores come live from The Graph's Agent0 index.
   - Fixture map stays for `fixture:low-rep` ONLY, with its demo flag; delete nothing.

5. **Tests** (vitest): live-endpoint test (env-gated, skips without key) asserting a real lookup returns reputation in [0,1] + validation enum; fixture behavior unchanged; fallback-to-neutral on outage unchanged.

6. **Docs** (one line each): `docs/demo.md` — reputation beats now read live Agent0 data (endpoint + identities named); `app/.env.example` — `THEGRAPH_API_KEY` row (free key, thegraph.com Studio) with the "reads public data, deploys nothing" note.

## Acceptance criteria

- [ ] Live query against the default endpoint returns a real agent with real feedback scores (test green with key, clean skip without).
- [ ] Demo reputation beats run against the real identities; the numbers on screen match the index (spot-check one by hand in the explorer).
- [ ] Fixture path still passes; outage fallback still deterministic.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` green. No engine/policy/schema changes. No new reason codes. No on-chain writes anywhere in this wave.

## Out of scope

Deploying any subgraph (nothing to index — zero-contract decision stands); writing on-chain feedback (rigging trust signals is disqualification territory); Hedera Agent0 coverage (doesn't exist upstream); video/narration (human).
