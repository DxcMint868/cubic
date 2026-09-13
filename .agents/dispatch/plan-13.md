# DISPATCH PROMPT — plan-13 (council hardening; micro-wave)

You are implementing exactly ONE plan of the Cubic MVP:
`.agents/plans/plan-13-council-hardening.md`
You are already on branch `plan-13` in your assigned working directory.

CONTEXT: all waves W1–W7 plus plans 11–12 are merged. This wave closes the code-owned findings of a 6-reviewer security council (tracer, security, integration, AI-engineer, contract, PO) on the secrets lifecycle. Four surgical fixes, no model changes. The plan was written from the council reports — trust it.

READ FIRST, in this order:
1. `AGENTS.md` (repo rules — includes GitNexus: impact analysis before editing symbols, detect_changes before committing; if the index is stale or errors, note it and continue, don't block on it). FIRST THING in your worktree, index it for GitNexus: `npx gitnexus analyze $(git rev-parse --show-toplevel)` — plain `npx gitnexus analyze` only works in the home repo, never inside a worktree.
2. `PROJECT.md` — skim §8 Ledger role, §15 sponsor qualifications.
3. `MEMORY.md` (read-only for you).
4. `.agents/plans/plan-00-architecture.md` — shared contracts (§B.1, §F event payloads, §G). Canonical; never redefine them. Your sanctioned additions: `capability.revoked` event + `origin` inside `reasoning_ref` (record both as contract addenda in your final report).
5. Your plan file — the only work you do.

FILE FENCE — you own ONLY:
- `app/src/server/logging.ts`: shared SECRET regex export ONLY
- `app/src/server/gateway/ingest.ts`: redaction constant swap + depth-cutoff resolution ONLY
- `app/src/server/gateway/orchestrator.ts`: error-code enum mapping at emit boundary ONLY (no flow changes)
- `app/src/server/events/types.ts`: `capability.revoked` event ONLY
- `app/src/server/capability/verify.ts`: emit inside `revokeCapability` ONLY
- `app/src/server/events/projection.ts`: revoked mapping row ONLY
- `app/src/server/ledger/dev.ts` or startup path: ledger boot-gate ONLY
- `app/src/server/payments/x402.ts`: `OPERATOR_KEY_NOT_PROTECTED` mapping ONLY
- TraceView: `origin` tag render + NOTHING else
- new test file(s) for this wave's behavior
- `docs/ledger.md`: compromise runbook + exposure query ONLY

Shared-file rules:
- `app/src/server/db/schema.ts` is frozen. No migrations. No engine changes. No new reason codes.
- Anything else outside your fence: STOP and report; do not edit.
- Do NOT edit `MEMORY.md` or other plans' files. Tick your plan's AC checkboxes as you verify them (your own plan file you MAY edit).

PRODUCT REVIEW (the merger runs the `product-owner` gate on your branch after you report done — pre-empt it):
- Every error string a judge could see must be fixed-enum or redacted — no raw internals on agent surfaces.
- Honesty labels intact everywhere; no new overclaim sentences.
- Beat numbering follows PROJECT.md §17 exactly.

SELF-REVIEW (mandatory — you run your own council; this is not optional):

a. DURING the work — after each major step, not just at the end — spawn a council of 2 subagents on that step's diff: one Explorer-type (trace how the new code is/will be consumed — imports, callers, schema consumers, event shapes vs the plan-00 contracts) and one General-type, adversarial (prove the step wrong — hunt contradictions with your plan, missing literals, anything a literal executor would have to invent). Give both the plan file + the diff so far. Read both reports; fix every valid finding or rebut it in writing in your final report. (opencode: subagent_type `explore` + `general`.)
b. WHEN FINISHED — BEFORE reporting done — spawn the `contract-reviewer` subagent (repo profile `.opencode/agents/contract-reviewer.md`, invoke by name) on your branch as the final gate. If it returns BLOCK: fix every item (re-consult your council as needed) and re-run the gate until MERGE. Attach the gate verdict + a council-findings summary to your final report. Only then tick your last AC, commit, and report done.
c. If your harness cannot spawn subagents: do both reviews inline (write the for/against as working notes), execute the contract-reviewer checklist from its file manually, and state plainly in your final report that review was inline, not spawned. "No subagents" is never an excuse to skip review.

ENV: `app/.env.local` already contains `DATABASE_URL` + `HEDERA_*`. Never print, log, or commit env contents.

TEST DISCIPLINE: integration tests create their own throwaway tenant (slug `test-plan-13`). Never mutate the demo tenant.

DEFINITION OF DONE:
- Every AC in your plan ticked.
- `pnpm typecheck && pnpm lint && pnpm test` green.
- Repo runnable: `pnpm dev` boots.
- Commit per task: `plan-13: <task summary>`.
- Final report: what you built, AC status, deviations + why, the two contract addenda, files touched, what the merger needs to know.
