# DISPATCH PROMPT — plan-12 (sponsor-prize hardening; small micro-wave)

You are implementing exactly ONE plan of the Cubic MVP:
`.agents/plans/plan-12-sponsor-hardening.md`
You are already on branch `plan-12` in your assigned working directory.

CONTEXT: all waves W1–W7 plus plan-11 are merged. This wave closes the code-owned gaps from the product-owner sponsor-prize audit (Ledger seam, approver identity, airtight demo). Small and surgical — four display/plumbing changes, no redesign. The plan was PO-reviewed BEFORE you got it (SHIP-WITH-GAPS, all gaps folded in) — trust it.

READ FIRST, in this order:
1. `AGENTS.md` (repo rules — includes GitNexus: impact analysis before editing symbols, detect_changes before committing; if the index is stale or errors, note it and continue, don't block on it). FIRST THING in your worktree, index it for GitNexus: `npx gitnexus analyze $(git rev-parse --show-toplevel)` — plain `npx gitnexus analyze` only works in the home repo, never inside a worktree.
2. `PROJECT.md` — skim §8 Ledger role, §15 sponsor qualifications, §17 beats (payment=Beat 4, Ledger=Beat 5).
3. `MEMORY.md` (read-only for you).
4. `.agents/plans/plan-00-architecture.md` — shared contracts (§B.1, §F approval payload, §G). Canonical; never redefine them. Your ONE sanctioned addition: optional `resolved_by` on the `ledger.approval.completed` payload (record as contract addendum in your final report).
5. Your plan file — the only work you do.

FILE FENCE — you own ONLY:
- `app/src/server/ledger/dev.ts` (new DevSecretProtector) + factory addition in `app/src/server/ledger/provider.ts`
- `payments/x402.ts`: ONLY the operator-key read site (route through protector)
- resolve routes: `api/approvals/[id]/resolve` (accept + emit `resolved_by`) + `api/demo/run` (internal default only)
- `events/types.ts`: ONLY the optional `resolved_by` field on `ledger.approval.completed`
- TraceView: capability promo line, RESOLVED BY join, HashScan link ONLY (no other component logic)
- `demo/agent.ts`: preflight flag asserts + explicit `resolved_by` on resolve calls + `demo/treasury.ts` resolve call ONLY
- new test file(s) for this wave's behavior
- `docs/ledger.md` + `docs/demo.md`: the specified one-liners ONLY

Shared-file rules:
- `app/src/server/db/schema.ts` is frozen. No migrations in this wave — event log carries the new field.
- `app/src/server/gateway/policy/engine.ts`: no changes. No new reason codes.
- Anything else outside your fence: STOP and report; do not edit.
- Do NOT edit `MEMORY.md` or other plans' files. Tick your plan's AC checkboxes as you verify them (your own plan file you MAY edit).

PRODUCT REVIEW (the merger runs the `product-owner` gate on your branch after you report done — pre-empt it):
- Every claim a judge could read must be true on dev backend: protector labeled, mock labels intact, narration-neutral code.
- No overclaim sentences anywhere (docs, comments shown on screen, summaries). When in doubt, understate.
- Beat numbering follows PROJECT.md §17 exactly.

SELF-REVIEW (mandatory — you run your own council; this is not optional):

a. DURING the work — after each major step, not just at the end — spawn a council of 2 subagents on that step's diff: one Explorer-type (trace how the new code is/will be consumed — imports, callers, schema consumers, event shapes vs the plan-00 contracts) and one General-type, adversarial (prove the step wrong — hunt contradictions with your plan, missing literals, anything a literal executor would have to invent). Give both the plan file + the diff so far. Read both reports; fix every valid finding or rebut it in writing in your final report. (opencode: subagent_type `explore` + `general`.)
b. WHEN FINISHED — BEFORE reporting done — spawn the `contract-reviewer` subagent (repo profile `.opencode/agents/contract-reviewer.md`, invoke by name) on your branch as the final gate. If it returns BLOCK: fix every item (re-consult your council as needed) and re-run the gate until MERGE. Attach the gate verdict + a council-findings summary to your final report. Only then tick your last AC, commit, and report done.
c. If your harness cannot spawn subagents: do both reviews inline (write the for/against as working notes), execute the contract-reviewer checklist from its file manually, and state plainly in your final report that review was inline, not spawned. "No subagents" is never an excuse to skip review.

ENV: `app/.env.local` already contains `DATABASE_URL` + `HEDERA_*`. Never print, log, or commit env contents.

TEST DISCIPLINE: integration tests create their own throwaway tenant (slug `test-plan-12`). Never mutate the demo tenant.

DEFINITION OF DONE:
- Every AC in your plan ticked.
- `pnpm typecheck && pnpm lint && pnpm test` green.
- Repo runnable: `pnpm dev` boots.
- Commit per task: `plan-12: <task summary>`.
- Final report: what you built, AC status, deviations + why, the approval-payload addendum, files touched, what the merger needs to know.
