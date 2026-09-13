# Cubic demo — video runbook (plan-16)

The take is a three-surface window: **chat left** (`/demo/chat`, the
executor), **approvals right** (`/console/approvals`, the approver — new
requests land live, no refresh), and a **third tab with the live chain
surfaces** (Graph playground + QuickNode agent page + Basescan). Press
**PLAY** in chat and narrate — the scenario runs hands-free beat-by-beat and
lands on `/network`. Everything on screen is the real pipeline: verbatim
intents, real reason codes, queryable traces, real onchain records.

## Onchain roster (all ours, all live on Base Sepolia testnet)

| Agent (console name) | ERC-8004 identity | Feedback |
|---|---|---|
| deploy-agent | `84532:9223` | 95/100 |
| treasury-agent | `84532:9224` | 90/100 |
| reader-agent | `84532:9225` | 92/100 |
| low-rep-research-agent | `8453:74108` (borrowed mainnet, real negative) | ≈0.10 |

Re-register / re-feedback any time (throwaway testnet keys only):
`OWNER_KEY=… CLIENT_KEY=… pnpm --filter app exec tsx scripts/register-agent-8004.ts`,
then pin the printed ids in `seed.ts`. Scores stay ≥ 0.80 (except lab-1) so
no beat changes — only the source of the number does.

## 30-second linear flow (shoot this first)

| # | Tab | Action | Narration (literal — Play uses these exact cues) |
|---|---|---|---|
| 0 | chat | Beat 0 title card | "One agent. One gateway. Every tool call interrogated — allow, deny, or escalate." |
| 1 | chat | read PR #421 → ALLOW | "The agent reads PR #421. Low risk — the gateway allows it." |
| 2 | chat | scan → 402 discovery receipt | "It needs a security scan. The service answers 402 — twenty-five cents on Hedera — and the gateway holds the capability until the budget policy says yes." |
| 3 | chat + approvals | merge → ESCALATE, sign in console | "The scan is clean, so the agent asks to merge. High risk — watch the approver tab: the request lands live, the human signs with their wallet, and the signature is sealed into the approval's fingerprint." |
| 3b | third tab | playground + agent page | "Same agent, same score — onchain, in the subgraph, right now. Not our database: theirs." |
| 4 | chat | injected `.env` read → DENY | "Then the attack: injected instructions tell the agent to read production secrets. The gateway denies it — no capability, no execution." |
| 5 | chat | over-budget scan → DENY | "It tries to overspend its task budget next. Same answer — denied, before any money moves." |
| 6 | — | Play lands on `/network` | "And every one of those decisions is already live on the network." |

Closing line: "MCP gives agents tools. ERC-8004 gives them identity. The
Graph gives us trust context. Ledger gives us a hardware root of trust. We
provide the authorization layer that decides what an agent is actually
allowed to do."

Beat numbering follows PROJECT.md §17 exactly (payment = Beat 4, Ledger =
Beat 5). The chat take covers Beats 1–3 + 6–7 hands-free; Beats 4 (paid scan
settlement) and 5 (Ledger approval) run via the scripted commands below and
their traces are opened in the console tab.

## Full script (second, for the complete take)

### Pre-take checklist

- [ ] Postgres migrated + reachable: `GET /api/health` → `{"ok":true,"data":{"db":"up",…}}`
- [ ] Dev server on :3000: `pnpm dev` (the seeded scanner endpoint is
      `http://localhost:3000/api/services/scanner/scan`; the purchase leg
      re-fetches its challenge from there)
- [ ] Wallet topped up: funded testnet operator in `app/.env.local`
      (`HEDERA_OPERATOR_ID` + `HEDERA_OPERATOR_KEY` + `HEDERA_NETWORK=testnet`)
      AND the merchant account `X402_PAY_TO_ACCOUNT=0.0.10482549` (public
      account id, not a secret — without it every payment self-pays and the
      facilitator rejects with `amount_mismatch`). A full take settles real
      25¢ runs — at ~$0.075/HBAR that is ≈3.3 HBAR plus gas per settlement;
      top up at portal.hedera.com well above that before the take
- [ ] Anchor topic created (post-top-up): `pnpm --filter app hcs:init` →
      prints `HCS_TOPIC_ID=…`; add it to `app/.env.local`. Without it the
      trace shows fingerprints with no topic link (anchor-disabled — the UI
      says so honestly). Topic-explorer links are real-or-absent, never
      fabricated
- [ ] Subgraph override set: `AGENT0_SUBGRAPH_URL` = the Base Sepolia Agent0
      endpoint in `app/.env.local` (our fleet is `84532:*`; lab-1's mainnet
      identity resolves through the built-in mainnet fallback). Without it,
      owned agents read the mainnet deployment and miss → neutral fallback.
- [ ] Third tab ready: Graph playground with the agent query for
      `84532:9223` + the QuickNode agent page
      (`erc-8004.quicknode.com/agents/base-sepolia/9223`) + a Basescan tab.
      Same IDs, same scores as our console — that sameness IS the beat.
- [ ] Approver wallet ready: a browser wallet (any test account) for the
      SIGN & APPROVE popup. No wallet → unsigned dev resolve, labeled
      stand-in — decide before shooting.
- [ ] `LEDGER_PROVIDER` unset (= `dev`): unsigned approvals resolve via the
      resolve route, narrated as the stand-in (see Beat 5)
- [ ] Bypass flags clear: the preflight aborts unless `X402_DEV_BYPASS`
      and `X402_SIMULATE_FAILURE` are unset or `"0"` — a real take never runs
      with them on (don't be surprised by the abort; unset them and re-run)
- [ ] LangSmith take decision (trace links): keyed take needs BOTH
      `LANGSMITH_API_KEY` set AND `LANGSMITH_TRACING=true` (the SDK defaults
      tracing OFF — key alone yields no link); unkeyed take narrates the
      honest absence instead. Decide before shooting, not during
- [ ] Free-text take decision: keyed take needs `OPENROUTER_API_KEY` set
      (model defaults to `openai/gpt-4o-mini` via `CHAT_MODEL`); unkeyed take
      keeps the honest templates-only free-text box (disabled + labeled) and
      never claims the model figured anything out — template buttons are
      labeled as scenarios
- [ ] Swarm optional: `pnpm --filter app swarm` in a second terminal for the
      Beat 7 zoom-out backdrop

### Rehearse (dev, free) vs record (live, spends)

- Rehearse: run the whole take with Play + the commands below — every DENY,
  ESCALATE, and discovery beat is free. Only the Beat 4 settlement spends.
- Record: one funded run. Each full happy-path run (script, route, or live
  test) settles a real 25¢ on Hedera testnet. Adversarial fixtures and chat
  discovery turns spend nothing.

### Exact commands

```bash
# terminal 1 — gateway (needs app/.env.local: DATABASE_URL + HEDERA_*)
pnpm dev

# terminal 2, left tab — the hands-free take
open http://localhost:3000/demo/chat   # press PLAY, narrate the cues above

# terminal 2, right tab — approvals + traces
open http://localhost:3000/console/tasks

# Beat 4 — machine payment (the 2–4 minute scripted run, narrates + asserts)
# Needs the dev server above AND DATABASE_URL in this shell's env.
pnpm --filter app demo
# → prints the trace URL + console task URL + beat summary table at the end

# Beat 5 — Ledger (high-risk merge → ESCALATE → dev stand-in approval)
# Narrate: "on hardware this is the Ledger approval — identical event chain."
curl -X POST http://localhost:3000/api/approvals/<id>/resolve \
  -H 'content-type: application/json' -d '{"outcome":"approved"}'

# adversarial reel (no server needed, DATABASE_URL only; deterministic)
pnpm --filter app demo:adversarial

# treasury branch (needs the dev server + DATABASE_URL in this shell; no
# Hedera env — dev-mode executor, no funds move)
pnpm --filter app demo:treasury
# → prints the trace URL + console task URL + treasury beat table at the end

# chat + anchor coverage (throwaway tenants, never the demo tenant)
pnpm --filter app demo:chat
pnpm --filter app exec vitest run tests/anchors.test.ts

# full automated coverage (live chain skips cleanly without a funded operator)
pnpm --filter app exec vitest run tests/e2e.demo.test.ts

# server-side convenience (same happy path, in-process; for live demos)
curl -X POST http://localhost:3000/api/demo/run | jq .
```

Remote gateway: `BASE_URL=https://cubic.example pnpm --filter app demo`.
Note: the purchase leg still settles against the seeded `:3000` scanner
endpoint unless the demo tenant's `scanner.scan` tool row is repointed.

## Beat sheet (PROJECT.md §17 numbering; maps 1:1 to plan-00 §N)

| Beat | §N | Chat (left tab) | Console (right tab) |
|---|---|---|---|
| 1 — problem | 1 | Beat 0 title card | Narrate over Beat 6's DENY: without the gateway this read succeeds |
| 2 — gateway | 2 | read PR → ALLOW (`default-v1/default-allow`), verbatim intent bubble | trace shows intent → decision → capability → execution |
| 3 — real execution | 2–3 | scan discovery receipt ($0.25 · hedera · challenge ref); merge escalates, approve in console → capability + execution (deploy target is mock-always; the escalate→approval→capability→execution chain around it is the real tested behavior) | approval queue + trace |
| 4 — machine payment | 3 | (scripted) `402 Payment Required` → bounded spend policy → Hedera settlement → report | `payment-v1` ALLOW → Blocky402/testnet → `payment.completed` + settlement ref |
| 5 — Ledger | 4 | (scripted) HIGH RISK → approval → capability released | ESCALATE → `POST /api/approvals/<id>/resolve` (dev stand-in; on hardware this is the Ledger approval, identical event chain) → `capability.issued` → execution |
| 6 — attack | 5 | injected secret read → DENY `secret_resource`, no capability, no execution; over-budget scan → DENY `budget_exceeded` | trace shows the DENYs with zero executions |
| 7 — network | 6 | Play lands on `/network` | Same `audit_events` project live over SSE (`/api/network/stream`) |

On-camera honesty rules: mock labels intact, dev provider labeled
(`DEV (stand-in)` badge on merge turns), template buttons labeled as
scenarios, HCS links real-or-absent. The only camera beats for attacks are
the `.env` read and the over-budget purchase — slur/off-scope input stays an
off-camera parser e2e, never the take.

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
| low reputation | `agent:lab-1` live Base Agent0 `8453:74108` (real negative feedback) read | ESCALATE `reputation_below_threshold` |

## Chat templates (surfaced branches — all already enforced, zero engine changes)

| Template | Call | Outcome |
|---|---|---|
| cross-task read | `github.read_file {repo:"evil/org"}` | DENY `resource_outside_task` |
| unknown tool | `github.delete_repo` | DENY `tool_not_allowed` |
| capability replay | consume an issued capability twice | rejected `replay` |
| expired capability | consume past `expires_at` | rejected `expired` |
| treasury drain | $450k swap → escalate → approver rejects | no capability, no execution |
| deploy-production | `deploy.production` | ESCALATE `risk_requires_approval` |

## HCS fingerprint anchoring

Allowlisted events (`policy.evaluated`, `capability.*`, `payment.completed|failed`,
`ledger.approval.completed`, `task.completed`) submit their sha256 fingerprint
to the HCS topic fire-and-forget from the projection step — never awaited,
warn-only on failure. No receipt storage: the mirror node is the record, and
the trace API derives the identical fingerprint per event (`anchor:
{fingerprint, topic_id}`, computed not stored). Verify on camera: open any
trace, copy a fingerprint, find it on the topic in the HashScan explorer.

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
  real 25¢ on Hedera testnet. Adversarial fixtures, chat discovery turns,
  and template clicks spend nothing (simulated failure / payment-required
  only) except the local loopback scan.
- `POST /api/demo/run` is unauthenticated and spends real money: it re-seeds
  (wiping demo-tenant state) and settles 25¢ per call. Never expose the demo
  gateway publicly during a take.
- One demo at a time: the script, the treasury script, and the route all
  re-seed and pick the latest open task — concurrent runs will resolve each
  other's tasks (treasury additionally grafts tools/policy rows, so never run
  it alongside the main demo or the swarm). An aborted treasury run closes its
  own task best-effort; if the gateway was unreachable, re-seed before the
  next main-demo take.
