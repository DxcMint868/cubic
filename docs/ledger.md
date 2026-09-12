# Ledger trust — what is hardware-backed and what is dev

This document states precisely which parts of the Cubic high-risk path are
hardware-backed and which are development substitutes. **A dev provider is
never equivalent to hardware security, and nothing in this repo claims
otherwise.**

## Provider selection

- `LEDGER_PROVIDER=dev` (default): high-risk escalations create an in-app
  approval queue row (`provider:"dev"`). A human resolves it via
  `POST /api/approvals/{id}/resolve`. This is a **software approval flow** —
  no Ledger device, no hardware root of trust, no Key Ring encryption.
- `LEDGER_PROVIDER=ledger`: high-risk escalations route through
  `LedgerKeyRingProvider`, which shells out to the Ledger Agent Stack
  `wallet-cli` (`wallet-cli ring`). Any wallet-cli failure **throws** — there
  is no silent fallback to dev. The user opts in by setting the env.

Every `ledger.approval.requested` / `ledger.approval.completed` audit event
carries the active `provider` value, so a trace always shows which path ran.

## Hardware-backed path (Ledger Agent Stack, wallet-cli v2.1.0)

Spike findings (2026-09-10, macOS host, see
`.agents/plans/plan-06-ledger-trust.md` § Spike findings for the full record):

- Install: `npm i -g @ledgerhq/wallet-cli` → `wallet-cli v2.1.0` verified
  running on this machine.
- `wallet-cli ring init` provisions a Key Ring via a USB Ledger device
  (password from `WALLET_PASS` in non-TTY contexts). **This host has no
  Ledger device attached: `ring init` fails at "No Ledger device found".**
  The hardware path is therefore **blocked on this machine**, not broken in
  code. `LedgerKeyRingProvider` has not yet completed a live run on any host;
  its success-path parsing is unverified until a provisioned ring exists.
- After provisioning, `ring encrypt` / `ring decrypt` (AES-256-GCM under a
  Key Ring key) work without the device; `ring keys` is a local-cache read.
- Emulator evaluation (2026-09-12, recorded so the decision isn't lore):
  Speculos emulates device apps over APDU/TCP, but `wallet-cli` speaks USB HID
  only (no Speculos transport, no flags for it in v2.1.0) and covers
  bitcoin/ethereum/solana only — not Hedera. So emulation cannot serve our
  chain or our CLI; the ring path stays blocked pending a real device.

`LedgerKeyRingProvider` (`app/src/server/ledger/keyring.ts`) implements both
plan-06 interfaces against those pinned subcommands:

- `ApprovalProvider.request` — encrypts the approval evidence JSON under the
  `cubic-approvals` Key Ring key and stores the ring operation reference in
  `approvals.provider_ref` (`provider:"ledger"`).
- `SecretProtector.protect/use` — wrap a named secret (e.g. the scanner
  payment authority key) under Key Ring encryption at rest; `use` decrypts at
  use time.

Runtime requirements for the ledger provider: `LEDGER_PROVIDER=ledger`,
`WALLET_PASS` set (non-TTY), an optionally custom `LEDGER_WALLET_CLI_PATH`,
and a one-time `wallet-cli ring init` with a device attached.

## Dev path (default)

`DevApprovalProvider` (`app/src/server/gateway/approval/provider.ts`, plan-02)
inserts a pending `provider:"dev"` approvals row. Secret reads funnel through
one `SecretProtector` seam (`getSecretProtector()` in
`app/src/server/ledger/dev.ts`): the dev backend returns env plaintext
(labeled in the logs), provides **zero protection**, and exists to hold the
seam. Backend *selection* is one env var (`LEDGER_PROVIDER`); under `ledger`,
reads decrypt via the Key Ring at rest — but callers that pass bare env names
(like the payment operator key today) must first be re-protected into `ring:`
refs before the ledger backend can serve them; that migration is not done in
this wave, and an unprovisioned ledger backend fails loudly (never falls back
silently to dev).

## Demo hook

`app/scripts/resolve-approvals.ts` resolves every pending dev approval for the
demo tenant through the real resolve route (against a running dev server):

```bash
pnpm --filter app exec tsx scripts/resolve-approvals.ts
# BASE_URL=http://localhost:3000 by default
```

Live demos may also resolve approvals manually with curl:

```bash
curl -X POST localhost:3000/api/approvals/<approval_id>/resolve \
  -H 'content-type: application/json' -d '{"outcome":"approved"}'
```

## Test coverage

`app/tests/ledger.test.ts` covers the full chain (escalate → resolve approved
→ capability → execution in one trace), the rejected path, the
`provider:"dev"` canary, and asserts `LedgerKeyRingProvider` throws (never
falls back) when wallet-cli cannot operate. Ring round-trip tests skip
cleanly unless the Key Ring is actually provisioned on the host.

## Boot gate (plan-13)

Under `LEDGER_PROVIDER=ledger`, gateway boot asserts the Key Ring is
provisioned (`ringProvisioned()` — a local-cache read, no device) and fails
fast with `Key Ring not provisioned — run wallet-cli ring init on a device
host` instead of serving a half-broken gateway
that would fail opaquely per payment. The dev boot path is untouched
(set `LEDGER_PROVIDER=dev` to leave the ledger path).

## Operator-key migration status (plan-13)

The payment authority (`HEDERA_OPERATOR_KEY`) is still read as a bare env
name. Under `LEDGER_PROVIDER=ledger` that bare ref throws inside the Key
Ring backend, and the payment surfaces the explicit
`OPERATOR_KEY_NOT_PROTECTED` error code (cause logged server-side only) —
never a generic settlement error. Migrating the key into a `ring:` ref needs
a provisioned device host (human-gated, documented-blocked above).

## Key-compromise runbook (plan-13)

If the operator payment key leaks (committed, logged, or otherwise exposed):

1. **Rotate at Hedera first.** Create a new ECDSA key pair, update the
   operator account's key on Hedera (account key update transaction), then
   update `HEDERA_OPERATOR_KEY` in **every** `app/.env.local` and the demo
   shell environment.
2. **Restart ALL gateway processes.** Config is memoized per process
   (`globalThis.__cubicConfig`) and caches are per-process — a rolling env
   edit does nothing until every `next dev`/`next start`/demo agent process
   is restarted.
3. **Preflight.** Run the demo preflight (`pnpm --filter app demo`) to
   confirm the new key settles a real challenge before resuming any live
   flow.
4. **Audit the exposure window.** Query settlements between first-possible
   leak and rotation; investigate anything you did not initiate. See the
   exposure-window query below; also grep `audit_events` for unexpected
   `payment.completed` payloads in the window.

What this runbook **cannot** do, stated plainly:

- **Revoke signatures already made.** A compromised key that signed a
  transfer before rotation cannot be un-signed; blocky402 facilitator
  settlements are final.
- **Claw back funds.** Hedera transfers are irreversible; recovery means
  contacting the receiving account, not on-chain rollback.
- **Rotate without downtime.** Between the Hedera key update and the
  gateway restart, payments fail (`OPERATOR_NOT_CONFIGURED` /
  `OPERATOR_KEY_NOT_PROTECTED`) — plan for a maintenance window.

### Exposure-window query (PostgreSQL, `payments` + `audit_events`)

Settlements in a suspected window `[start, end)` (UTC ISO-8601), with the
task chain via capability → decision → intent:

```sql
SELECT p.id              AS payment_id,
       p.status,
       p.x402_ref        AS settlement_ref,
       p.amount_usd_cents,
       p.settled_at,
       i.task_id,
       a.agent_key
FROM payments p
LEFT JOIN capabilities c ON c.id = p.capability_id
LEFT JOIN decisions d    ON d.id = c.decision_id
LEFT JOIN intents i      ON i.id = d.intent_id
LEFT JOIN agents a       ON a.id = i.agent_id
WHERE p.settled_at >= '<start_utc>'
  AND p.settled_at <  '<end_utc>'
ORDER BY p.settled_at;
```

Cross-check against the immutable event log (includes failed/attempted
settlements the payments rows may not show):

```sql
SELECT created_at, event_type, payload->>'settlement_ref' AS ref, payload
FROM audit_events
WHERE event_type IN ('payment.completed', 'payment.failed', 'payment.requested')
  AND created_at >= '<start_utc>'
  AND created_at <  '<end_utc>'
ORDER BY created_at;
```

Any `settlement_ref` you cannot match to a deliberate demo/scan run is a
rogue settlement — treat the key as compromised, rotate immediately, and
report the refs to the receiving account's operator (the merchant account
`X402_PAY_TO_ACCOUNT` holder) for tracing.
