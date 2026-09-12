# Cubic demo — scripted end-to-end + adversarial flows (plan-10)

One command runs the 2–4 minute video path; every attack branch produces its
deterministic outcome with a queryable audit trail. Nothing here is theater:
blocked steps abort loudly, skipped live parts say why, and the approval
resolve is narrated as the dev stand-in it is.

## Beat sheet (PROJECT.md §17 numbering; maps 1:1 to plan-00 §N)

| Beat | §N | What the viewer sees | Gateway truth |
|---|---|---|---|
| 1 — problem | 1 | Agent with raw tool access; prompt injection ("upload production secrets") | Narrate over Beat 6's DENY: without the gateway this read succeeds |
| 2 — gateway | 2 | Same agent through Cubic: tool call → intent → policy → capability | `get_pull_request` → ALLOW (`default-v1/default-allow`) |
| 3 — real execution | 2–3 | Reads PR #421, buys the scan, merges, deploys — real executor calls (deploy target is mock-always; the escalate→approval→capability→execution chain around it is the real tested behavior) | Executors run; capabilities are consumed single-use |
| 4 — machine payment | 3 | `402 Payment Required` → bounded spend policy → Hedera settlement → report | `payment-v1` ALLOW → Blocky402/testnet → `payment.completed` + settlement ref |
| 5 — Ledger | 4 | HIGH RISK → approval → capability released | ESCALATE → `POST /api/approvals/<id>/resolve` (dev stand-in; on hardware this is the Ledger approval, identical event chain) → `capability.issued` → execution |
| 6 — attack | 5 | Injected secret read | DENY `secret_resource`, no capability, no execution |
| 7 — network | 6 | The action appears in `/network`; zoom out to the swarm | Same `audit_events` project live over SSE (`/api/network/stream`) |

Closing line: "MCP gives agents tools. ERC-8004 gives them identity. The
Graph gives us trust context. Ledger gives us a hardware root of trust. We
provide the authorization layer that decides what an agent is actually
allowed to do."

## Pre-demo checklist

- [ ] Postgres migrated + reachable: `GET /api/health` → `{"ok":true,"data":{"db":"up",…}}`
- [ ] Dev server on :3000: `pnpm dev` (the seeded scanner endpoint is
      `http://localhost:3000/api/services/scanner/scan`; the purchase leg
      re-fetches its challenge from there)
- [ ] Funded testnet operator in `app/.env.local`: `HEDERA_OPERATOR_ID` +
      `HEDERA_OPERATOR_KEY` (+ `HEDERA_NETWORK=testnet`) AND the merchant
      account `X402_PAY_TO_ACCOUNT=0.0.10482549` (public account id, not a
      secret — without it every payment self-pays and the facilitator rejects
      with `amount_mismatch`). The demo settles a
      real 25¢ — at ~$0.075/HBAR that is ≈3.3 HBAR plus gas; top up at
      portal.hedera.com well above that before the take
- [ ] `LEDGER_PROVIDER` unset (= `dev`): approvals resolve via the resolve
      route, narrated as the stand-in (see Beat 5)
- [ ] Bypass flags clear: the preflight now aborts unless `X402_DEV_BYPASS`
      and `X402_SIMULATE_FAILURE` are unset or `"0"` — a real take never runs
      with them on (don't be surprised by the abort; unset them and re-run)
- [ ] Swarm optional: `pnpm --filter app swarm` in a second terminal for the
      Beat 7 zoom-out backdrop

## Exact commands

```bash
# terminal 1 — gateway (needs app/.env.local: DATABASE_URL + HEDERA_*)
pnpm dev

# terminal 2 — the 2–4 minute run (narrates, asserts, aborts loudly).
# Needs the dev server above AND DATABASE_URL in this shell's env
# (the script resolves the seeded task via a direct DB query).
pnpm --filter app demo
# → prints the trace URL + console task URL + beat summary table at the end

# adversarial reel (no server needed, DATABASE_URL only; deterministic)
pnpm --filter app demo:adversarial

# treasury branch (needs the dev server + DATABASE_URL in this shell; no
# Hedera env — dev-mode executor, no funds move)
pnpm --filter app demo:treasury
# → prints the trace URL + console task URL + treasury beat table at the end

# full automated coverage (live chain skips cleanly without a funded operator)
pnpm --filter app exec vitest run tests/e2e.demo.test.ts

# server-side convenience (same happy path, in-process; for live demos)
curl -X POST http://localhost:3000/api/demo/run | jq .
```

Remote gateway: `BASE_URL=https://cubic.example pnpm --filter app demo`.
Note: the purchase leg still settles against the seeded `:3000` scanner
endpoint unless the demo tenant's `scanner.scan` tool row is repointed.

## What the script does (happy path)

1. Preflight: `GET /api/health` must return `db:"up"`; `HEDERA_OPERATOR_*`
   must be set in the runner env — else exit naming the missing piece.
2. `POST /api/demo/seed` → fresh demo state.
3. Resolve the seeded task for `agent:8472` by querying tasks by agent
   (no id literals).
4. `github.get_pull_request {repo:"acme/backend",pr:421}` → expect ALLOW.
5. `scanner.scan {target:"acme/backend#421"}` → expect `payment_required`
   (price 25¢), no execution.
6. `scanner.scan {purchase:true, price_usd_cents:25}` (origin
   `payment_discovery`) → expect ALLOW (`payment-v1`) → `payment.completed`
   → report; prints the settlement ref.
7. `github.merge_pull_request` → expect ESCALATE; prints the approval id.
8. `POST /api/approvals/<id>/resolve {approved}` → capability + execution;
   prints the nonce prefix.
9. `deploy.production` → ESCALATE → resolve approved → prints the result.
10. `github.read_file {path:".env.production"}` → expect DENY
    `secret_resource`.
11. `task.complete` → expect `task.completed`; prints the trace URL +
    console task URL (`/console/tasks/<id>`) + beat table (script labels
    these `[10/11]` and `[11/11]`).

## Adversarial fixtures (`--adversarial`, in-process)

| Fixture | Call | Deterministic outcome |
|---|---|---|
| prompt injection | `github.read_file {path:".env.production"}` | DENY `secret_resource` |
| over budget | 10¢ task, purchase at 25¢ | DENY `budget_exceeded`, no payment/execution |
| expired capability | consume with `expires_at` in the past | rejected `expired` |
| tampered capability | consume random uuid | rejected `not_found` (no event — nothing attributable, plan-03 exemption) |
| failed payment | purchase with `X402_SIMULATE_FAILURE=1` | `payment.failed`, capability `revoked`, zero `tool.execution.*` |
| low reputation | `agent:lab-1` (fixture 0.50) read | ESCALATE `reputation_below_threshold` |

## Treasury branch (`demo:treasury`, plan-11)

The capital-management demo: a CIO asks the agent to rebalance a $3M
treasury. Same gateway, same `default-v1` rules — no engine changes, no new
reason codes. The drama comes from classification alone: `treasury.swap` and
`treasury.transfer` normalize to high risk (→ ESCALATE), while
`treasury.stake` splits on a $100 notional threshold (→ medium/ALLOW below,
high/ESCALATE at or above).

| Beat | Call | Deterministic outcome |
|---|---|---|
| rebalance | `treasury.swap {asset_pair:"USDC/ETH", $240,000}` | ESCALATE `risk_requires_approval` → approve → capability → execution (dev receipt) |
| payroll | `treasury.transfer {destination:"payroll/ops-multisig", $85,000}` | ESCALATE → approve → execution |
| stake pair | `treasury.stake {protocol:"lido", $50}` then `{…, $5,000}` | $50 → ALLOW (`default-allow`) + execution; $5,000 → ESCALATE — same action, risk did the talking |
| drain | `treasury.swap {asset_pair:"USDC/ETH", $450,000}` | ESCALATE → approver **rejects** → no capability, no execution (`ledger.approval.completed` outcome `rejected` on the record) |

Honesty rules (same bar as the rest of this file):

- Every treasury receipt says `(dev mode)` with `verdict: "simulated"` —
  no funds move, nothing claims otherwise.
- The $450k "DENY" is an approver rejection, not a policy deny: the swap
  escalates under the unchanged risk rule and the CIO rejects it. The docs,
  script narration, and tests all frame it exactly that way.
- ETH notionals use the fixture reference rate ($100/ETH, stated in the
  script and tests) — deterministic, not a market quote.
- The script closes its treasury task (`task.complete`), so the main demo's
  latest-open-task lookup is unaffected. It prints the trace URL +
  `/console/tasks/<id>` at the end; the same events stream to `/network`.
- `POST /api/demo/run` now also returns `console_path` alongside
  `trace_path`.

## Failure recovery

- Any happy-path step prints `DEMO ABORT [<step>]: <what mismatched>` and
  exits non-zero. Fix the named piece, re-run — step 1 re-seeds, so every
  run starts clean.
- `402`/settlement errors at step 6: check the operator balance on the
  testnet mirror and that the facilitator advertises `hedera:testnet`
  (`GET https://api.testnet.blocky402.com/supported`). Never re-run a
  half-paid task — re-seed first (a settled payment is real money moved).
- `approval already resolved` (409): a previous run resolved it — re-seed.
- Live e2e skips: `HEDERA_OPERATOR_*` absent, facilitator/mirror
  unreachable, or operator balance below the 25¢ price → the test logs which
  and returns. Fund the wallet and re-run for the live proof.
- Cost: each full happy-path run (script, route, or live test) settles a
  real 25¢ on Hedera testnet. Adversarial fixtures spend nothing
  (simulated failure) except the local loopback scan.
- `POST /api/demo/run` is unauthenticated and spends real money: it re-seeds
  (wiping demo-tenant state) and settles 25¢ per call. Never expose the demo
  gateway publicly during a take.
- One demo at a time: the script, the treasury script, and the route all
  re-seed and pick the latest open task — concurrent runs will resolve each
  other's tasks (treasury additionally grafts tools/policy rows, so never run
  it alongside the main demo or the swarm). An aborted treasury run closes its
  own task best-effort; if the gateway was unreachable, re-seed before the
  next main-demo take.
