---
guide: .agents/guides/guide-01-bootstrap.md
status: ready
depends-on: [plan-04-execution-mcp]
---

# Plan 05 — Hedera x402: the paid security scan as a real consequence of authorization

**HOW TO USE:** **EXACT** blocks are verbatim contracts — copy them. Package names and the challenge shape are NOT given: task 0 pins them. Steps are ordered.

## Objective

The scanner becomes a genuinely x402-gated service settled through Blocky402 on Hedera testnet. Spending is a policy decision; the agent never holds payment credentials.

## Preconditions

plan-04 merged (the `{status:"payment_required"}` seam exists); `HEDERA_OPERATOR_ID` / `HEDERA_OPERATOR_KEY` funded on testnet (if absent: implement everything, mark live-settlement ACs `blocked-on-env`, never fake a settlement).

## Steps

0. **Spike (timeboxed, FIRST)**: from live Hedera/x402 docs pin: (a) the official x402 client package for Hedera, (b) Blocky402 facilitator endpoint + required auth, (c) the accepted testnet pricing asset, (d) the exact 402 challenge JSON shape. Append a `## Spike findings` section to THIS plan file with pinned versions, URLs, and the challenge shape. Do not trust package names anywhere in this plan.

1. **EXACT — 402 gate** on `POST /api/services/scanner/scan`: no valid payment → HTTP 402, envelope-conformant (extra payment fields live INSIDE `error`, per plan-00 §G):

```json
{ "ok": false,
  "error": { "code": "PAYMENT_REQUIRED", "message": "x402 payment required",
             "price_usd_cents": 25, "network": "hedera",
             "challenge": "<spike-pinned shape goes here — replace this placeholder>" } }
```

   `price_usd_cents` = `config().X402_SCANNER_PRICE_CENTS` (never hardcoded). `X402_DEV_BYPASS=1` returns the plan-04 dev report instead, logging a loud warning line each time.

2. **EXACT — discovery flow** (agent-driven, two calls): the `ScannerExecutor` receives the executor↔service 402 and returns `{status:"payment_required", price_usd_cents, challenge}` to the orchestrator; the orchestrator emits `service.discovered` `{intent_id, service:"scanner", price_usd_cents, challenge_ref: sha256(JSON.stringify(challenge))}` and returns `data.payment_required = {price_usd_cents, challenge}` — NO execution row, NO consume (plan-04 rule). The demo agent then submits the follow-up itself: tool `scanner.scan`, args `{target, purchase: true, price_usd_cents}`, which ingests with `origin:"payment_discovery"` (plan-02's origin parameter) and routes to `payment-v1` via the selection algorithm — no special-casing.

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

   `HederaX402Provider` implements it with the spike-pinned client + `HEDERA_OPERATOR_*` (server-side only). `X402_SIMULATE_FAILURE=1` → `pay` returns `{status:"failed", error_code:"SIMULATED_SETTLEMENT_FAILURE"}`.

4. **EXACT — payment wiring** (purchase intents only): after `allow` + `issueCapability` (budget = `amount_usd_cents`) → insert `payments` row (`status:"requested"`) → emit `payment.requested` → `provider.pay(...)` → completed: update row (`completed`, `x402_ref`, `settled_at`) + emit `payment.completed` → consume capability with numeric `amount` → execute the scan (the scanner calls `verifySettlement` before returning the report — real gating). Failed: update row (`failed`) + emit `payment.failed` + `revokeCapability(capabilityId)` (plan-03) + no execution.

5. **Scanner side**: 402 → (facilitator-verified payment) → report (same JSON as plan-04, `mode:"x402"`, price from config).

6. **Docs (track requirement)**: `docs/payment-flow.md` — setup, env vars, text architecture diagram, the exact 402 → `payment_required` → purchase → Blocky402 settlement → report sequence, and a note that submission needs a ≤5-minute demo video. Match what the code actually does.

## Acceptance criteria

- [ ] Live on Hedera testnet (env-gated; skip cleanly without env): 402 → `payment_required` → purchase allow → settlement → `verifySettlement` true → report; `payments` row `completed` with `x402_ref`; `payment.requested` + `payment.completed` in trace.
- [ ] Over-budget: task `budget_usd_cents: 10`, price 25 → deny `budget_exceeded` (payment-v1 `budget` rule) — vitest with the plan-02 test-double pattern.
- [ ] `X402_SIMULATE_FAILURE=1` → `payment.failed`, capability `revoked`, zero `tool.execution.*` events for that capability, no report.
- [ ] Canary: no `HEDERA_OPERATOR_KEY` value (or any key material) in any API response, event payload, or log line.
- [ ] Agent response holds only the budget-scoped capability; `docs/payment-flow.md` exists and matches the flow.

## Out of scope

HCS audit trails / recurring payments (future), multi-service marketplace.
