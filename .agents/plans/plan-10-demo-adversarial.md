---
guide: .agents/guides/guide-01-bootstrap.md
status: ready
depends-on: [plan-05-hedera-x402, plan-06-ledger-trust, plan-07-graph-context, plan-09-frontend]
---

# Plan 10 — Demo + adversarial flows: prove the system, then break it

**HOW TO USE:** **EXACT** blocks are verbatim contracts — copy them. Steps are ordered. You are the LAST agent — everything else is merged.

## Objective

One command runs the 2–4 minute demo end-to-end; every adversarial branch produces its deterministic outcome with a queryable audit trail.

## Preconditions

plans 05–09 merged; the `## Spike findings` in plan-05/plan-06 (merged into main) hold the pinned x402/wallet-cli facts. Read `PROJECT.md` §17 (beats) and plan-00 §C/§D/§N.

## Steps

1. **EXACT — `demo/agent.ts`** (tsx script, `pnpm --filter app demo`). Preflight FIRST: `GET /api/health` must return `db:"up"`; `HEDERA_OPERATOR_*` must be set for the paid steps — otherwise exit immediately with a message naming the missing piece (the demo must never limp through a wrong state). Then, printing a narration line before each step:

```text
1. POST /api/demo/seed                                            → "Fresh demo state."
2. Use the seeded task for agent:8472 (query tasks by agent — no id literals).
3. tool-call github.get_pull_request {repo:"acme/backend",pr:421} → expect allow; print decision + rule
4. tool-call scanner.scan {target:"acme/backend#421"}              → expect data.payment_required (price 25)
5. tool-call scanner.scan {target:"acme/backend#421", purchase:true, price_usd_cents:25}
                                                                  → expect allow (payment-v1) → payment completed → report; print settlement ref
6. tool-call github.merge_pull_request {repo:"acme/backend",pr:421}→ expect escalate; print approval id
7. POST /api/approvals/<id>/resolve {outcome:"approved"}          → expect capability + execution; print nonce prefix
8. tool-call deploy.production {repo:"acme/backend"}              → expect escalate; resolve approved → execution; print result
9. tool-call github.read_file {repo:"acme/backend",path:".env.production"} → expect DENY secret_resource; print reason
10. tool-call task.complete                                       → expect task.completed
11. print GET /api/audit/trace/<task_id> URL and a beat-by-beat summary table
```

   Each step asserts its expected outcome and aborts loudly on mismatch.

2. **EXACT — adversarial fixtures** (each a scripted sequence with assertions, together via `pnpm --filter app demo:adversarial`):

```text
prompt injection   → github.read_file {path:".env.production"}        → decision deny, reason secret_resource
over budget        → task budget 10, scanner.scan purchase price 25    → decision deny, reason budget_exceeded
expired capability→ consumeCapability with expires_at in the past    → rejected, reason expired
tampered capability→ consumeCapability with random uuid               → rejected, reason not_found
failed payment     → X402_SIMULATE_FAILURE=1 purchase                 → payment.failed, capability revoked, zero tool.execution.* events
low reputation     → agent:lab-1 (fixture 0.50) get_pull_request       → decision escalate, reason reputation_below_threshold
```

3. **`POST /api/demo/run`** (optional convenience): triggers seed + happy-path sequence server-side for live demos.

4. **E2E smoke** (`app/tests/e2e.demo.test.ts`): asserts the ordered event chain for the happy path — `intent.created → policy.evaluated → capability.issued → service.discovered → payment.requested → payment.completed → capability.issued → tool.execution.started → tool.execution.completed → capability.escalated → ledger.approval.requested → ledger.approval.completed → capability.issued → tool.execution.completed → capability.escalated → ledger.approval.completed → capability.issued → tool.execution.completed → capability.denied → task.completed` — and each adversarial reason code. Live-settlement parts skip cleanly without Hedera env (`test.skipIf`).

5. **`docs/demo.md`**: beat sheet mapped 1:1 to the plan-00 §N sequence (now incl. the deploy beat), pre-demo checklist (DB migrated, seeded, funded testnet wallet, `LEDGER_PROVIDER`, swarm optional), the exact commands, and failure-recovery notes.

6. **`MEMORY.md` final update** (you are the only agent allowed): append the end-state entry (what's live, how to run the demo, known gaps).

## Acceptance criteria

- [ ] `pnpm --filter app demo` (with env) executes the full happy path against the live stack, passes every in-sequence assertion, and prints the trace URL.
- [ ] `pnpm --filter app demo:adversarial` passes all six fixtures with the exact reason codes above.
- [ ] E2E smoke asserts the exact ordered event chain; green where env permits, clean skips otherwise.
- [ ] All beats map 1:1 to plan-00 §N and run in ≤4 minutes.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` green.

## Out of scope

Video production; submission paperwork.
