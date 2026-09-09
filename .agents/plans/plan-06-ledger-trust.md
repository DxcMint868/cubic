---
guide: .agents/guides/guide-01-bootstrap.md
status: ready
depends-on: [plan-03-capabilities]
---

# Plan 06 — Ledger trust: high-risk approval path + Key Ring secret protection

**HOW TO USE:** **EXACT** blocks are verbatim contracts — copy them. wallet-cli commands are NOT given: task 0 pins them. Steps are ordered.

## Objective

The high-risk path gets a genuine Ledger integration via the Agent Stack (`wallet-cli ring`), with an honest dev fallback that is never described as hardware security.

## Preconditions

plan-03 merged (escalation → pending approvals exist); read current Ledger wallet-cli docs before the spike.

## Steps

0. **Spike (FIRST)**: install the Ledger Agent Stack wallet-cli on this machine (verified absent). Verify `wallet-cli ring init` and subsequent ring operations run. Append a `## Spike findings` section to THIS plan file with exact install commands + what worked. If it cannot run here: mark the hardware path blocked, keep DevProvider as default, and state that explicitly in the docs — never claim a dev mock is hardware security.

1. **EXACT — `ledger/provider.ts` interfaces:**

```ts
export interface ApprovalProvider {
  request(input: { decision_id: string; action: string; resource: string; risk_class: RiskClass; reason_codes: string[] }): Promise<{ approval_id: string }>;
}
export interface SecretProtector {
  protect(name: string, secret: string): Promise<string>;  // returns ciphertext/ref for storage
  use(ref: string): Promise<string>;                       // returns plaintext at use time
}
```

2. **EXACT — `ledger/dev.ts` (`DevApprovalProvider`)**: `request` inserts `approvals {type:"ledger", provider:"dev", status:"pending"}` and returns the id. **EXACT — `POST /api/approvals/[id]/resolve`** body `{outcome: "approved" | "rejected"}`:
   - updates the row (`status = outcome`, `completed_at = now`)
   - emits `ledger.approval.completed` `{approval_id, decision_id, provider:"dev", outcome}`
   - if approved → `issueCapability` for the original escalate decision (plan-03's approval gate now opens) → proceed to execution (plan-04 execution phase) → respond with the full tool-call shape (capability + execution filled in)
   - if rejected → respond `{ok:true, data:{decision:"escalate", approval_id, approval_outcome:"rejected", capability:null, ...}}`; no capability ever.

3. **`ledger/keyring.ts` (`LedgerKeyRingProvider`)**: implements BOTH interfaces by shelling out to wallet-cli (spike-pinned subcommands). `request` records approval evidence via the ring (`provider:"ledger"`, `provider_ref` = ring operation ref); `protect/use` wrap the scanner payment authority key (`HEDERA_OPERATOR_KEY`) under Key Ring encryption at rest. Selected via `LEDGER_PROVIDER=ledger`; any wallet-cli failure → throw (do NOT silently fall back to dev — the user decides by setting the env).

4. **Demo hooks**: `POST /api/demo/run` (or a small script) auto-resolves pending dev approvals so the demo beat can flow; live demos may resolve manually via the endpoint instead.

5. **Docs**: state precisely what is hardware-backed vs dev in `docs/ledger.md` (or a README section), citing the spike findings.

## Acceptance criteria

- [ ] Full chain test: `github.merge_pull_request` → escalate (`merge-risk`) → `ledger.approval.requested` (`provider:"dev"`) → resolve approved → `ledger.approval.completed` → `capability.issued` → `tool.execution.completed` — all visible in one trace.
- [ ] Rejected approval → no capability, no execution; trace shows `ledger.approval.completed` with `outcome:"rejected"`.
- [ ] Dev-provider events all carry `provider:"dev"` (canary assertion); no doc string claims dev == hardware.
- [ ] If the spike succeeded: a runnable script demonstrates ring init + `protect`/`use` round-trip; findings recorded in this plan file. If not: hardware path marked blocked in docs + plan file.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` green (keyring tests skip cleanly when wallet-cli is unavailable).

## Out of scope

A full secret-management product; USB-required flows on hosts without devices.
