---
guide: .agents/guides/guide-01-bootstrap.md
status: ready
depends-on: [plan-03-capabilities]
---

# Plan 06 — Ledger trust: high-risk approval path + Key Ring secret protection

## Objective

The high-risk path gets a genuine Ledger integration via the Agent Stack (`wallet-cli ring`), with an honest dev fallback that is never described as hardware security.

## Preconditions

plan-03 merged (ESCALATE → approvals rows already exist); plan-00 §I read; read the current Ledger wallet-cli docs before the spike.

## Tasks

0. **Spike (do first)**: install the Ledger Agent Stack wallet-cli on this machine — it is currently absent (verified). Verify `wallet-cli ring init` and subsequent ring operations work; record exact install commands + verified behaviors by appending a `## Spike findings` section to **this plan file** (the wave merger folds them into `MEMORY.md` — do not edit `MEMORY.md` yourself). If the environment cannot run it, mark the hardware path blocked, keep DevProvider, and say so in the docs.
1. **`ledger/provider.ts`**: the provider boundary — `requestApproval(decision) → approval`, `resolveApproval(id, outcome)`, plus secret-protection hooks (`protectSecret`, `useSecret`) for Key Ring encryption.
2. **`ledger/dev.ts`**: DevApprovalProvider — approval queue + `POST /api/approvals/[id]/resolve` with `{approve|reject}`; UI-facing state; explicitly labeled `provider:"dev"` in every record and event.
3. **`ledger/keyring.ts`**: LedgerKeyRingProvider — shells out to wallet-cli: (a) approval completion evidence tied to the ring; (b) `protectSecret` / `useSecret` encrypting the scanner payment authority key at rest under the Key Ring (device provisioned once; later operations without the device, per documented Key Ring behavior). Selected via `LEDGER_PROVIDER=ledger`.
4. **High-risk wiring**: ESCALATE → `ledger.approval.requested` → provider; approve → `ledger.approval.completed` → capability issued (only now) → execution; reject → no capability, the denial recorded on the task.
5. **Demo hooks**: scripted approval resolution in the demo agent (auto-approve for the video beat, or manual via the resolve endpoint for live demos).
6. **Tests**: dev approval approve/reject flows (unit); keyring provider tests skip cleanly when wallet-cli is unavailable; an honesty test asserting dev-provider events carry `provider:"dev"`.

## Acceptance criteria

- [ ] High-risk action → ESCALATE → `ledger.approval.requested` → approval → `ledger.approval.completed` → capability → execution; the full chain appears in the trace.
- [ ] A rejected approval → no capability; the task records the denial.
- [ ] With wallet-cli working: ring init + secret encrypt/decrypt round-trip demonstrated by a script; docs state precisely what is hardware-backed vs dev.
- [ ] Nothing anywhere claims DevProvider is equivalent to hardware security (docs + event labels).
- [ ] `pnpm typecheck` / `lint` / `test` green.

## Out of scope

A full secret-management product; USB-required flows on hosts without devices.
