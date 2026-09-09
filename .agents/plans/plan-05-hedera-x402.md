---
guide: .agents/guides/guide-01-bootstrap.md
status: ready
depends-on: [plan-04-execution-mcp]
---

# Plan 05 — Hedera x402: the paid security scan as a real consequence of authorization

## Objective

The scanner becomes a genuinely x402-gated service settled through Blocky402 on Hedera testnet. Spending is a policy decision; the agent never holds payment credentials.

## Preconditions

plan-04 merged; `HEDERA_OPERATOR_ID` / `HEDERA_OPERATOR_KEY` set server-side (payment authority wallet, funded on testnet); plan-00 §J read.

## Tasks

0. **Spike (timeboxed, do first)**: verify the current official Hedera x402 stack against live docs — exact client/facilitator package names, Blocky402 integration requirements, the testnet pricing asset. Record pinned versions + findings by appending a `## Spike findings` section to **this plan file** (the wave merger folds them into `MEMORY.md` — do not edit `MEMORY.md` yourself). Do not trust package names in this plan.
1. **402 gate**: `POST /api/services/scanner/scan` without valid payment → `402` + x402 payment challenge (`X402_SCANNER_PRICE_CENTS`, default 25). Keep an `X402_DEV_BYPASS=1` escape hatch for offline tests, loudly logged whenever used.
2. **Discovery path**: when the executor relays a 402, the gateway emits `service.discovered` and the agent path re-submits a purchase intent (`scanner.scan` with `purchase:true`), normalized to `action=purchase_security_scan` with the amount taken from the challenge.
3. **Payment policy**: refine `payment-v1` rules — service allowlist, `task_budget_remaining >= price`, reputation rule from facts. DENY → `capability.denied` (over-budget demo fixture: a $0.10 task vs the $0.25 price).
4. **`payments/x402.ts`**: fulfill the challenge with the server-held payment authority (`HEDERA_OPERATOR_*`), settle via the Blocky402 facilitator on Hedera testnet; persist the `payments` row; emit `payment.requested` → `payment.completed` (with settlement refs) or `payment.failed`.
5. **Settlement verification**: the scanner returns the report only after verifying settlement through the facilitator — real gating, not header theater.
6. **Capability integration**: payment capabilities carry `budget_usd_cents`; consume with `amount=price`; failed payment → capability `revoked` + `payment.failed`, execution never starts.
7. **Docs (track requirement)**: payment-flow documentation (setup, architecture, env vars, the 402 → settlement → result sequence) in `app/README.md` or `docs/`. Note the ≤5-minute demo video requirement for submission.
8. **Tests**: over-budget DENY (unit); simulated rejected settlement → no report, capability revoked (unit); happy path marked integration/network-gated (skipped without Hedera env).

## Acceptance criteria

- [ ] Live end-to-end on Hedera testnet: 402 → policy ALLOW → Blocky402 settlement → report returned; `payments` row + `payment.requested` / `payment.completed` events with settlement references.
- [ ] The agent holds only a budget-scoped capability; payment authority never leaves the server (automated assertion: no key material in any response or event payload).
- [ ] A $0.10-budget task → deterministic DENY with a reason code.
- [ ] Simulated settlement failure → `payment.failed`, no report, capability revoked.
- [ ] Payment-flow documentation exists and matches the implemented flow.

## Out of scope

HCS audit trails / recurring payments (Hedera extra credit — future), a multi-service marketplace.
