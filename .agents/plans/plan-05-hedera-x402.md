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

- [x] Live on Hedera testnet (env-gated; skip cleanly without env): 402 → `payment_required` → purchase allow → settlement → `verifySettlement` true → report; `payments` row `completed` with `x402_ref`; `payment.requested` + `payment.completed` in trace. (`tests/x402.live.test.ts` green 2026-09-12; settlement `0.0.7162784@…` verified on the mirror node)
- [x] Over-budget: task `budget_usd_cents: 10`, price 25 → deny `budget_exceeded` (payment-v1 `budget` rule) — vitest with the plan-02 test-double pattern. (`tests/x402.test.ts`, own price 33)
- [x] `X402_SIMULATE_FAILURE=1` → `payment.failed`, capability `revoked`, zero `tool.execution.*` events for that capability, no report. (`tests/x402.test.ts`)
- [x] Canary: no `HEDERA_OPERATOR_KEY` value (or any key material) in any API response, event payload, or log line. (`tests/x402.test.ts` canary test, incl. the loud dev-bypass warning line)
- [x] Agent response holds only the budget-scoped capability; `docs/payment-flow.md` exists and matches the flow. (live test asserts `data.capability.budget_usd_cents == price`; no key material in any response)

## Out of scope

HCS audit trails / recurring payments (future), multi-service marketplace.

## Spike findings (task 0, 2026-09-12 — pinned against live docs + live endpoints)

Pinned versions/URLs verified live on this machine (facilitator `/supported` and mirror `exchangerate` both fetched OK).

### (a) Official x402 client package for Hedera

- **`@x402/hedera`** (npm, v2.25.0, Apache-2.0, repo `x402-foundation/x402`). Hedera implementation of the x402 **v2** `exact` scheme. Re-exports the `@hiero-ledger/sdk` primitives it needs (`PrivateKey`, `Client`, `TransferTransaction`, …) — import them from `@x402/hedera`, NOT `@hiero-ledger/sdk` directly (duplicate SDK instance bug → `t.startsWith is not a function` at runtime).
- Client usage (pinned):
  ```ts
  import { createClientHederaSigner, PrivateKey } from "@x402/hedera";
  import { ExactHederaScheme } from "@x402/hedera/exact/client";
  const signer = createClientHederaSigner(accountId, PrivateKey.fromStringECDSA(key), { network: "hedera:testnet" });
  const scheme = new ExactHederaScheme(signer);
  const signed = await scheme.createPaymentPayload(2, requirements); // → { payload: { transaction: "<base64 TransferTransaction bytes>" } }
  ```
- Key format: **ECDSA `0x`-prefixed** private key (`fromStringECDSA`).

### (b) Blocky402 facilitator

- Base URL (testnet): **`https://api.testnet.blocky402.com`** — open access, **no auth** on testnet (mainnet later, `X-Api-Key`). Wire format is x402 **v2 only** (`x402Version: 2`); v1 envelopes rejected.
- Endpoints: `GET /supported` → `{ kinds: [...], signers: { "hedera:*": [...] } }`; `POST /verify` and `POST /settle` with body `{ x402Version: 2, paymentPayload, paymentRequirements }`.
- Live-verified `/supported` (2026-09-12): Hedera kind = `{ "x402Version": 2, "scheme": "exact", "network": "hedera:testnet", "extra": { "feePayer": "0.0.7162784" } }`. The client MUST copy this `extra.feePayer` into `paymentRequirements.extra.feePayer` or the SDK throws before signing.
- `/settle` success → `{ success: true, transaction: "0.0.<feePayer>@<seconds>.<nanos>", network, payer }` — network-native settlement ref (this becomes `payments.x402_ref` / `settlement_ref`). Failure → `{ success: false, errorReason, errorMessage }`.
- Docs: https://blocky402.com/docs/api-reference, https://blocky402.com/docs/quickstart (repo `blockydevs/blocky402`).

### (c) Accepted testnet pricing asset

- **Native HBAR** (`asset: "0.0.0"`), amount in **tinybars** (1 HBAR = 10^8 tinybars). Chosen over testnet USDC (`0.0.429274`) because HBAR needs no token association on payer or payee.
- USD→tinybars conversion pinned to the **live Hedera mirror exchange rate**: `GET https://testnet.mirrornode.hedera.com/api/v1/network/exchangerate` → `{ current_rate: { cent_equivalent, hbar_equivalent } }` meaning `hbar_equivalent` HBAR = `cent_equivalent` cents (live-checked against CoinGecko: rate ⇒ $0.0755/HBAR vs spot $0.0740 ✓). Formula: `tinybars = round(price_usd_cents * hbar_equivalent / cent_equivalent * 1e8)` (25¢ ⇒ ≈331,019,713 tinybars ≈ 3.31 HBAR at the pinned rate).

### (d) Exact 402 challenge JSON shape (pinned — replaces the plan's placeholder)

The `challenge` inside the 402 envelope is the x402 v2 `paymentRequirements` object (+ one Cubic extension in `extra` for price binding):

```json
{
  "scheme": "exact",
  "network": "hedera:testnet",
  "amount": "<tinybars string>",
  "payTo": "<HEDERA_OPERATOR_ID — the merchant account, server-side only value>",
  "maxTimeoutSeconds": 300,
  "asset": "0.0.0",
  "extra": { "feePayer": "<from facilitator /supported>", "price_usd_cents": 25 }
}
```

- `extra.price_usd_cents` is a Cubic extension: the provider refuses to settle unless it equals the purchase intent's `amount_usd_cents` (agent cannot buy at a "discount" by lying about the price).
- Degraded mode (offline tests / missing operator env / unreachable facilitator): the 402 **status and envelope contract never change**; the challenge omits unavailable pieces (`extra.feePayer`, `amount`, `payTo`) and the envelope `message` notes it. Full shape only guaranteed when operator env + facilitator + mirror are reachable.
- Settlement verification: the scanner service calls `verifySettlement({challenge, settlement_ref})` → mirror node `GET /api/v1/transactions/{settlement_ref}` (indexed with retries) → transaction `result: "SUCCESS"` and a transfer crediting `payTo` by ≥ the required tinybars.

### Wiring decisions (recorded for the merger)

- The purchase wiring in the orchestrator runs only for intents with `origin: "payment_discovery"` (plan-02's origin parameter, set by the demo agent's follow-up per step 2). Agent-origin purchase intents normalize to `purchase_security_scan` and route through payment-v1 policy normally, but execute via the executor's discovery arm (they get `payment_required` again instead of a settlement) — keeps plan-02/plan-04 tests (which call purchases with default origin) green without editing their files, and there is no free-scan hole. (Note: the MCP facade never threads origin, so MCP-only clients can discover but not purchase — plan-10's demo agent must use the HTTP tool-call route for the purchase.)
- The purchase round fetches a **fresh** challenge directly from the service before `provider.pay` (x402 quotes are single-use; the round-1 challenge the agent echoed back only carried the price).
- **Merchant account (user-approved 2026-09-12)**: self-settlement (operator → operator) nets to zero and the Blocky402 facilitator rejects it with `invalid_exact_hedera_payload_amount_mismatch` (verified live). A distinct merchant account was provisioned with the dev wallet (~1.7 HBAR testnet, key discarded — the gateway never needs it): **`0.0.10482549`**, recorded in `app/.env.local` as `X402_PAY_TO_ACCOUNT` (optional env, read by `payments/x402.ts`; default without it is the operator id). The operator wallet was drained by the accumulated live settlements (~0.03 HBAR left) — **top up `HEDERA_OPERATOR_*` at portal.hedera.com before the demo**; the live test skips cleanly (balance guard) until then.
- Settlement verification is **fail-closed and process-local**: the provider records the exact settled requirements at settle time and `verifySettlement` only honors refs it settled (a restart/foreign process/mirror-scraped third-party transfer can never unlock a report). Post-settle throws reconcile best-effort (row failed + `payment.failed` + revoke, real `x402_ref` recorded when settlement landed).
- Facilitator base URLs are module constants in `payments/x402.ts` selected by `HEDERA_NETWORK`; the mainnet URL is documented-but-unverified (Blocky402: "coming soon").
- Extra fence exceptions, all disclosed: `app/src/server/executors/securityScan.ts` (required by step-2's EXACT executor-arm text; not listed in the dispatch fence), `app/tests/execution.test.ts` (`X402_DEV_BYPASS=1` keeps plan-04's dev contract under the new default gate), `app/tests/graph.test.ts` (two `it(..., 30000)` timeout bumps — pre-existing shared-Neon latency flake, same fix the merger applied in W4; logic untouched).
