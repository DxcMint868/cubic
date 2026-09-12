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
