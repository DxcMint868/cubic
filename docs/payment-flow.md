# Payment flow — the paid security scan (Hedera x402 via Blocky402)

The Cubic scanner is a genuinely x402-gated service settled on Hedera testnet
through the **Blocky402 facilitator**. Spending is a policy decision; the agent
never holds payment credentials — it only ever holds a budget-scoped capability.

This document matches the code in `app/src/server/payments/x402.ts`,
`app/src/app/api/services/scanner/scan/route.ts`, and the purchase wiring in
`app/src/server/gateway/orchestrator.ts` (plan-05).

## Architecture

```text
 agent (demo agent / MCP client)
    │  ①  scanner.scan {target}                    (plain intent, origin "agent")
    ▼
 CUBIC GATEWAY ── ingest → normalize → policy (default-v1) → ALLOW → capability
    │  ②  executor POSTs the scanner service
    ▼
 SCANNER SERVICE  /api/services/scanner/scan
    │  no payment → ③ HTTP 402 + x402 v2 paymentRequirements (the challenge)
    ▼
 ORCHESTRATOR: emit service.discovered {intent_id, service, price, challenge_ref}
              → respond payment_required = {price_usd_cents, challenge}
    (capability stays issued-but-unconsumed; it expires after 5 min)

 agent (follow-up)  ④  scanner.scan {target, purchase: true, price_usd_cents}
                       origin: "payment_discovery"
    ▼
 CUBIC GATEWAY ── ingest(origin=payment_discovery) → normalize (purchase intent,
    amount_usd_cents) → policy payment-v1 (service allowlist · budget ·
    reputation) → ALLOW → capability {budget = the authorized amount}
    │  ⑤  payments row (requested) + payment.requested
    │  ⑥  fresh challenge fetched from the service (x402 quotes are single-use)
    │  ⑦  HederaX402Provider.pay(): the server-held payment authority signs a
    │      TransferTransaction (operator → merchant payTo), Blocky402
    │      /verify → /settle on Hedera testnet
    │  ⑧  payments row (completed, x402_ref) + payment.completed
    │  ⑨  capability consumed (with the settled amount)
    ▼
 SCANNER EXECUTOR (purchase mode) POSTs {target, settlement_ref}
    ▼
 SCANNER SERVICE: verifySettlement() — mirror node
    GET /api/v1/transactions/0.0.<payer>-<secs>-<nanos>
    → result "SUCCESS" + transfer crediting payTo ≥ required tinybars
    │  verified → ⑩ report (mode:"x402")
    ▼
 ORCHESTRATOR: executions row + tool.execution.started / completed
              → agent receives ONLY the report + audit chain
```

Failed settlement (`payment.failed`): payments row marked failed, event
`payment.failed` emitted, capability **revoked**, no execution, no report.

## Setup

```bash
pnpm install          # @x402/hedera (+ @hiero-ledger/sdk devDep) in app/
pnpm db:migrate       # shared DB from plan-01
pnpm dev              # http://localhost:3000
```

Seed the demo tenant (includes the scanner tool with its service endpoint and
the `payment-v1` policy):

```bash
curl -X POST http://localhost:3000/api/demo/seed
```

### Environment (`app/.env.local`, never committed)

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | shared PostgreSQL (plan-01) |
| `HEDERA_NETWORK` | `testnet` (Blocky402 mainnet is not live yet) |
| `HEDERA_OPERATOR_ID` / `HEDERA_OPERATOR_KEY` | **payment authority** — server-side only; the wallet that PAYS for scans. Never exposed to agents, never in responses, event payloads, or logs. ECDSA `0x`-prefixed key. |
| `X402_PAY_TO_ACCOUNT` | the scanner's **merchant** account (receives payments). Must be a real account distinct from the operator — self-settlement nets to zero and the facilitator rejects it. Provisioned once; its key is not needed by the gateway. |
| `X402_SCANNER_PRICE_CENTS` | scan price in USD cents (default 25) |
| `X402_DEV_BYPASS` | `1` restores the plan-04 dev report, ungated, with a loud warning per request |
| `X402_SIMULATE_FAILURE` | `1` makes `pay()` return `SIMULATED_SETTLEMENT_FAILURE` (test hook) |

Fund the operator wallet with testnet HBAR: <https://portal.hedera.com/>
(faucet). The scan price is USD-denominated; each settlement moves HBAR at the
live Hedera exchange rate (`mirrornode /api/v1/network/exchangerate`), e.g.
$0.25 ≈ 3.3 HBAR at the time of writing.

## The exact sequence (verified live on Hedera testnet)

1. `POST /api/gateway/tool-call` `{tool: "scanner.scan", arguments: {target}}`
   → decision `allow` → capability issued → executor calls the scanner service
   → HTTP **402** with the challenge → orchestrator emits `service.discovered`
   and returns `data.payment_required = {price_usd_cents, challenge}`.
2. The agent re-submits the purchase with
   `{tool: "scanner.scan", arguments: {target, purchase: true, price_usd_cents}, origin: "payment_discovery"}`
   → `payment-v1` policy (service allowlist, budget: `25 ≤ 50 − spent`,
   reputation ≥ 0.80) → `allow` → capability `{budget_usd_cents: 25}`.
3. `payments` row `requested` → `payment.requested`.
4. Fresh challenge fetched; the provider validates `scheme: exact`,
   `network: hedera:testnet`, and `extra.price_usd_cents == amount_usd_cents`
   (an agent cannot buy at a discount), signs the transfer, and the Blocky402
   facilitator settles it (`/verify` → `/settle`, x402 v2).
5. `payments` row `completed` with `x402_ref` = the network-native
   `0.0.<feePayer>@<secs>.<nanos>` → `payment.completed`.
6. Capability consumed → executor re-calls the service with the settlement ref
   → the service verifies the settlement on the mirror node → report
   `mode:"x402"` → `tool.execution.started` / `tool.execution.completed`.
7. Everything is queryable: `GET /api/audit/trace/<task_id>`.

The 402 envelope (`price_usd_cents` from `X402_SCANNER_PRICE_CENTS`, never
hardcoded):

```json
{ "ok": false,
  "error": { "code": "PAYMENT_REQUIRED", "message": "x402 payment required",
             "price_usd_cents": 25, "network": "hedera",
             "challenge": { "scheme": "exact", "network": "hedera:testnet",
                            "amount": "<tinybars>", "payTo": "<merchant>",
                            "maxTimeoutSeconds": 300, "asset": "0.0.0",
                            "extra": { "feePayer": "<facilitator>",
                                       "price_usd_cents": 25 } } } }
```

If the facilitator/mirror/operator env is unreachable the 402 still returns —
the challenge degrades (pieces omitted) and the message says so. The challenge
is never faked into a valid payment.

## Security properties

- The agent holds a **budget-scoped capability**, never the payment authority
  or any credential. `X402_SIMULATE_FAILURE` / dev bypass are env-only.
- Settlement is verified **independently by the merchant** against the Hedera
  mirror node before any report is returned — a forged or absent settlement
  gets 402, never the report.
- The purchase follow-up must carry `origin: "payment_discovery"` (the
  gateway's discovery marker). An agent-origin "purchase" gets the discovery
  response again — no settlement, no free scan.
- Settlement refs are single-use per service process (MVP limitation: the
  replay guard is in-memory; a restart clears it).

## Hackathon submission notes (Hedera track)

The live paid request must be shown end-to-end in a demo video of **5 minutes
or less** (Hedera ETHOnline challenge requirement): 402 → `payment_required` →
purchase allow → Blocky402 settlement on Hedera testnet → verified report.
Submission also needs this repo's setup/architecture/payment-flow docs (this
file + README).
