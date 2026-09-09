---
guide: .agents/guides/guide-01-bootstrap.md
status: ready
depends-on: [plan-05-hedera-x402, plan-06-ledger-trust, plan-07-graph-context, plan-09-frontend]
---

# Plan 10 — Demo + adversarial flows: prove the system, then break it

## Objective

One command runs the 2–4 minute demo end-to-end, and every adversarial branch produces its deterministic outcome with a queryable audit trail.

## Preconditions

plans 05–09 merged; plan-00 §N demo beats read.

## Tasks

1. **`demo/agent.ts`** (tsx script + `pnpm --filter app demo`): a scripted agent executing the primary narrative — open task ($0.50 budget) → analyze → hit the 402 → payment decision → paid scan (Hedera/Blocky402) → high-risk merge → Ledger-backed approval → capability → execution → `task.completed`; console narration lines at each beat for the video.
2. **Adversarial fixtures** (each a script/HTTP sequence with assertions):
   - prompt injection → `github.read_file(.env.production)` → DENY
   - over-budget ($0.10 task) payment attempt → DENY
   - expired capability use → `capability.rejected`
   - tampered capability (random nonce) → `capability.rejected`
   - failed payment (simulated) → `payment.failed`, no execution
   - low-reputation agent → ESCALATE
3. **`POST /api/demo/run`** (optional convenience): triggers seed + the happy-path sequence server-side for live demos.
4. **E2E smoke** (`app/tests/e2e.demo.test.ts`): env-gated (network parts skip without Hedera env); asserts the complete event chain for the happy path and the reason code for every adversarial branch.
5. **Demo docs** (`docs/demo.md`): beat sheet (plan-00 §N), pre-demo checklist (DB migrated, seeded, funded testnet wallet, `LEDGER_PROVIDER`, swarm on), failure-recovery notes.
6. **`MEMORY.md`**: final implementation-state update.

## Acceptance criteria

- [ ] `pnpm --filter app demo` (with env) executes the full happy path against the live stack and prints the trace URL.
- [ ] Each adversarial branch yields its deterministic decision + events, verifiable via `/api/audit/trace/[taskId]`.
- [ ] The 402 / payment / Ledger / DENY beats map 1:1 to plan-00 §N and are demoable in ≤4 minutes.
- [ ] The E2E smoke is green where env permits and skips cleanly otherwise.

## Out of scope

Video production itself; submission paperwork.
