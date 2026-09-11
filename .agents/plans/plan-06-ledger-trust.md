---
guide: .agents/guides/guide-01-bootstrap.md
status: ready
depends-on: [plan-03-capabilities, plan-04-execution-mcp]
---

# Plan 06 — Ledger trust: high-risk approval path + Key Ring secret protection

**HOW TO USE:** **EXACT** blocks are verbatim contracts — copy them. wallet-cli commands are NOT given: task 0 pins them. Steps are ordered.

## Objective

The high-risk path gets a genuine Ledger integration via the Agent Stack (`wallet-cli ring`), with an honest dev fallback that is never described as hardware security.

## Preconditions

plans 03–04 merged (escalation → pending approvals exists; the execution phase the approval unlocks exists); read current Ledger wallet-cli docs before the spike.

## Steps

0. **Spike (FIRST)**: install the Ledger Agent Stack wallet-cli on this machine (verified absent). Verify `wallet-cli ring init` and subsequent ring operations run. Append a `## Spike findings` section to THIS plan file with exact install commands + what worked. If it cannot run here: mark the hardware path blocked, keep DevProvider as default, and state that explicitly in the docs — never claim a dev mock is hardware security.

1. **EXACT — `ledger/provider.ts`** (re-export + new interface; do NOT duplicate `DevApprovalProvider` — it lives in `gateway/approval/provider.ts` from plan-02):

```ts
export type { ApprovalProvider } from "../gateway/approval/provider";
export interface SecretProtector {
  protect(name: string, secret: string): Promise<string>;  // returns ciphertext/ref for storage
  use(ref: string): Promise<string>;                       // returns plaintext at use time
}
```

2. **EXACT — `POST /api/approvals/[id]/resolve`** body `{outcome: "approved" | "rejected"}`:
   - load the `approvals` row → its `decision_id` → load the `decisions` + `intents` rows (you need `action`, `resource`, `agent_key`, `amount_usd_cents` to rebuild the `IssueInput`).
   - update the row (`status = outcome`, `completed_at = now`).
   - emit `ledger.approval.completed` `{approval_id, decision_id, provider: config().LEDGER_PROVIDER, outcome}`.
   - if approved → `issueCapability({decision, decisionId, intent, policy})` (plan-03's gate now opens on the approved row) → continue into the plan-04 execution phase → respond with the full tool-call shape (capability + execution filled in).
   - if rejected → respond `{ok:true, data:{decision:"escalate", approval_id, approval_outcome:"rejected", capability:null, payment:null, execution:null, payment_required:null}}`; no capability ever.

3. **`ledger/keyring.ts` (`LedgerKeyRingProvider`)**: implements `ApprovalProvider` + `SecretProtector` by shelling out to wallet-cli (spike-pinned subcommands). `request` records approval evidence via the ring (`provider:"ledger"`, `provider_ref` = ring operation ref); `protect`/`use` wrap the scanner payment authority key under Key Ring encryption at rest. Selected via `LEDGER_PROVIDER=ledger`; any wallet-cli failure → throw (do NOT silently fall back to dev — the user decides by setting the env).

4. **Demo hook**: a small script (not a new route — `POST /api/demo/run` belongs to plan-10) that calls `POST /api/approvals/{id}/resolve {outcome:"approved"}` for all pending dev approvals. Live demos may resolve manually instead.

5. **Docs**: state precisely what is hardware-backed vs dev in `docs/ledger.md` (or a README section), citing the spike findings.

## Acceptance criteria

- [x] Full chain test: `github.merge_pull_request` → `capability.escalated` + `ledger.approval.requested` (`provider:"dev"`) → resolve approved → `ledger.approval.completed` → `capability.issued` → `tool.execution.completed` — all visible in one trace. (`app/tests/ledger.test.ts` full-chain test asserts the exact 9-event order + trace-route visibility.)
- [x] Rejected approval → no capability, no execution; trace shows `ledger.approval.completed` with `outcome:"rejected"`.
- [x] Dev-provider events all carry `provider:"dev"` (canary assertion); no doc string claims dev == hardware (`docs/ledger.md` states the opposite explicitly).
- [x] If the spike succeeded: a runnable script demonstrates ring init + `protect`/`use` round-trip; findings recorded in this plan file. If not: hardware path marked blocked in docs + plan file. → **Blocked branch taken**: no Ledger device on this host; findings + verdict recorded above and in `docs/ledger.md`; ring round-trip tests exist and skip cleanly (`ringProvisioned()` probe).
- [x] `pnpm typecheck && pnpm lint && pnpm test` green (keyring tests skip cleanly when wallet-cli is unavailable). Note: `tests/graph.test.ts` (plan-07's file, untouched here) has 2 pre-existing 5s-timeout flakes that fail identically with this plan's changes stashed — verified not caused by plan-06.

## Out of scope

A full secret-management product; USB-required flows on hosts without devices; touching `gateway/approval/provider.ts` (plan-02 owns it).

## Spike findings (2026-09-10, macOS host)

Install (verified working):

```bash
npm i -g @ledgerhq/wallet-cli   # also pnpm add -g / yarn global add / bun add -g
wallet-cli --version            # → wallet-cli v2.1.0
```

Pinned subcommands (from `wallet-cli ring --help`, v2.1.0):

- `wallet-cli ring init` — one-time provisioning; **device required**; password read from `WALLET_PASS` when no TTY (docs: `WALLET_PASS=$(security find-generic-password -a default -s ledger-wallet-cli -w)` on macOS).
- `wallet-cli ring encrypt -i <in> -o <out> --key <name>` — AES-256-GCM under a Key Ring key; also accepts stdin/stdout when `-i`/`-o` omitted.
- `wallet-cli ring decrypt -i <in> -o <out> --key <name>` — inverse.
- `wallet-cli ring keys` — list keys used on this machine (local cache, no network/device).
- `wallet-cli ring destroy` — tear down ring + wipe local member credentials.

Observed behavior on this machine:

1. `wallet-cli ring init` with `WALLET_PASS` set → "Generating member credentials…" → "Connect device, open Ledger Sync app" → **fails: "No Ledger device found. Unlock the device and try again."** No physical Ledger is attached, and `ring init` cannot complete without one.
2. Without a TTY and without `WALLET_PASS`, every `ring` command fails fast with a password-required error.
3. All commands accept `--output json` (default `human`); JSON shape is `{ok: true, data: ...}` / `{ok: false, error: {kind, name, tag, message}}`.

Verdict: **hardware path BLOCKED on this host** — the CLI is real and installed, but ring provisioning requires a USB Ledger device which is absent. DevProvider remains the default (`LEDGER_PROVIDER=dev`); `LedgerKeyRingProvider` shells out to the pinned subcommands above and throws on any wallet-cli failure (no silent fallback). Tests skip cleanly when the ring is not provisioned. Docs state plainly that dev is not hardware security.
