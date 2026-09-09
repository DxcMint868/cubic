---
guide: .agents/guides/guide-01-bootstrap.md
status: ready
depends-on: [plan-04-execution-mcp]
---

# Plan 05 — Hedera x402: the paid security scan as a real consequence of authorization

**HOW TO USE:** **EXACT** blocks are verbatim contracts — copy them. Package names are NOT given: task 0 pins them. Steps are ordered.

## Objective

The scanner becomes a genuinely x402-gated service settled through Blocky402 on Hedera testnet. Spending is a policy decision; the agent never holds payment credentials.

## Preconditions

plan-04 merged; `HEDERA_OPERATOR_ID` / `HEDERA_OPERATOR_KEY` funded on testnet (if absent: implement everything, mark live-settlement ACs `blocked-on-env`, never fake a settlement).

## Steps

0. **Spike (timeboxed, FIRST)**: from live Hedera/x402 docs pin: (a) the official x402 client package for Hedera, (b) Blocky402 facilitator endpoint + required auth, (c) the accepted testnet pricing asset (USDC or equivalent), (d) the exact 402 challenge JSON shape it emits. Append a `## Spike findings` section to THIS plan file with the pinned versions, URLs, and challenge shape. Everything below references "the spike-pinned client" — do not guess package names.

1. **EXACT — 402 gate** on `POST /api/services/scanner/scan`: no valid payment → HTTP 402 with:

```json
{ "ok": false, "error": { "code": "PAYMENT_REQUIRED", "message": "x402 payment required" },
  "price_usd_cents": 25, "network": "hedera",
  "challenge": { "/* spike-pinned x402 challenge shape */": true } }
```

   `X402_DEV_BYPASS=1` returns the plan-04 dev report instead (log a loud warning line each time it is used).

2. **EXACT — discovery flow** in the orchestrator: when the ScannerExecutor receives a 402, it returns `{status:"payment_required", price_usd_cents, challenge}`; the orchestrator emits `service.discovered` `{intent_id, service:"scanner", price_usd_cents, challenge_ref: sha256(JSON.stringify(challenge))}` and creates a follow-up intent via the normal ingest path: tool `scanner.scan`, args `{target, purchase: true, price_usd_cents}` (`origin:"payment_discovery"`). The plan-02 selection algorithm routes it to `payment-v1` automatically — do not special-case policy.

3. **EXACT — `payments/x402.ts`** interface:

```ts
export interface PaymentProvider {
  pay(input: { capability_id: string; service: "scanner"; amount_usd_cents: number; challenge: unknown }): Promise<
    | { status: "completed"; settlement_ref: string }
    | { status: "failed"; error_code: string }
  >;
  verifySettlement(input: { challenge: unknown; settlement_ref: string }): Promise<boolean>;
}
```

   The `HederaX402Provider` implements it with the spike-pinned client + `HEDERA_OPERATOR_*` (server-side only). `X402_SIMULATE_FAILURE=1` → `pay` returns `{status:"failed", error_code:"SIMULATED_SETTLEMENT_FAILURE"}` (for tests).

4. **EXACT — payment wiring** in the orchestrator (purchase intents only): after `allow` + `issueCapability` (budget = `amount_usd_cents`) → insert `payments` row (`status:"requested"`) → emit `payment.requested` → `provider.pay(...)` → completed: update row (`completed`, `x402_ref`, `settled_at`) + emit `payment.completed` → consume capability with `amount` → execute the scan (scanner verifies settlement via `verifySettlement` before returning the report — real gating). Failed: update row (`failed`) + emit `payment.failed` + capability `revoked` + no execution.

5. **Scanner side**: replace the plan-04 direct report with: 402 → (facilitator-verified payment) → report (same report JSON as plan-04, `mode:"x402"`).

6. **Docs (track requirement)**: `docs/payment-flow.md` — setup, env vars, architecture diagram in text, the exact 402 → ALLOW → Blocky402 settlement → report sequence, and a note that the submission requires a ≤5-minute demo video. Match what the code actually does.

## Acceptance criteria

- [ ] Live on Hedera testnet (env-gated; skip cleanly without env): 402 → policy allow → settlement → `verifySettlement` true → report; `payments` row `completed` with `x402_ref`; `payment.requested` + `payment.completed` events present in trace.
- [ ] Over-budget: task with `budget_usd_cents: 10`, scan price 25 → deny with `budget_exceeded` (from `payment-v1`, `budget` rule) — add this as a vitest case with the plan-02 test-double pattern.
- [ ] `X402_SIMULATE_FAILURE=1` → `payment.failed` event, capability status `revoked`, NO `tool.execution.*` events for that capability, no report.
- [ ] Automated assertion: no `HEDERA_OPERATOR_KEY` value, and no key material, appears in any API response, event payload, or log line (canary test).
- [ ] Agent holds only the budget-scoped capability in the response; `docs/payment-flow.md` exists and matches the flow.

## Out of scope

HCS audit trails / recurring payments (future), multi-service marketplace.
