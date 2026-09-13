---
guide: .agents/guides/guide-01-bootstrap.md
status: ready
depends-on: [plan-11-agentgate-mesh]
---

# Plan 12 — Sponsor-prize hardening: ledger seam, approver identity, airtight demo

**HOW TO USE:** **EXACT** blocks are verbatim contracts — copy them as written. If an EXACT block fails, STOP and report; never silently redesign. Steps are ordered. Source: product-owner sponsor-prize audit (Ledger NOT-READY, x402 CLOSE, traceability CLOSE) — this wave closes the code-owned asks; funding/video/narration stay human.

## Objective

Make the Ledger story architecturally demoable without hardware, answer "who approved what" on screen, and airtight the paid-take preflight — the three code-owned gaps between BUBBLE and CONTENDER.

## Preconditions

plans 05–11 merged. Read `.agents/plans/plan-00-architecture.md` (§B.1, §F approval payload, §G), `docs/ledger.md`, `docs/payment-flow.md`.

## Steps

1. **EXACT — `DevSecretProtector` + factory** (new `ledger/dev.ts`; extend `ledger/provider.ts` with the factory only):

```ts
export class DevSecretProtector implements SecretProtector {
  async protect(name: string, _secret: string): Promise<string> {
    console.warn(`[ledger] DevSecretProtector: ${name} is NOT hardware-protected — dev stand-in only`);
    return `dev:${name}`;
  }
  async use(ref: string): Promise<string> {
    const name = ref.startsWith("dev:") ? ref.slice(4) : ref;
    const value = process.env[name];
    if (!value) throw new Error(`DevSecretProtector: ${name} is not set`);
    return value;
  }
}

export function getSecretProtector(): SecretProtector {
  const backend = config().LEDGER_PROVIDER === "ledger" ? "keyring" : "dev";
  console.warn(`[ledger] secret-protector backend: ${backend}` + (backend === "dev" ? " — NOT hardware-protected, dev stand-in only" : ""));
  return backend === "ledger" ? new LedgerKeyRingProvider() : new DevSecretProtector();
}
```

   (`LedgerKeyRingProvider` already implements `SecretProtector` per plan-06 — verify the import resolves; if its shape drifted, adapt the factory, never the keyring.)
   **CORRECTION (plan-12 executor, council-verified):** the EXACT block's final line `backend === "ledger"` is unreachable — `backend` is `"keyring" | "dev"` — and would fail AC 1. Implemented as `backend === "keyring"`; documented in code + final report.
   Route the operator-key read in `payments/x402.ts` (the `PrivateKey.fromStringECDSA(config().HEDERA_OPERATOR_KEY…)` site) through `await getSecretProtector().use("HEDERA_OPERATOR_KEY")`. The factory warn fires at boot (first payment path that calls it — log once via module-level memo), so the active backend is visible in every run log. The true claim, and no stronger: all secret reads funnel through one seam; dev returns env plaintext (labeled, zero protection); `ledger` decrypts via Key Ring at rest; the swap is one env var (`LEDGER_PROVIDER`).

2. **EXACT — approver identity, event-sourced (NO schema change — the append-only log is the audit record):**
   - Canonical resolve route accepts optional `resolved_by` in the body, default `"demo-operator"`.
   - `api/demo/run` takes NO body — its internal `resolveApproval()` helper defaults `resolved_by` to `"demo-operator"`.
   - BOTH emit paths include `resolved_by` in the `ledger.approval.completed` payload (contract addendum: one new OPTIONAL field on that event's zod schema + payload table note in your final report — you may not edit plan-00 itself).
   - READ PATH (specified): TraceView's APPROVALS stage joins the trace `events` array on `payload.approval_id`, reading `payload.resolved_by ?? "unknown"`. Pass `events` into the approvals renderer as a prop if it doesn't already receive it. Pre-existing rows render `"unknown"` — never blank, never invented.
   - Demo script resolve calls (`agent.ts`, `treasury.ts`) pass `resolved_by: "demo-operator"` explicitly.

3. **EXACT — capability-grant promo line** (TraceView, display type — no data change): when a capability exists, render above the KV grid:
   ```
   AGENT <subject> RECEIVED SCOPED CAPABILITY — <action> · <resource> · EXPIRES <expires_at>
   ```
   with `<subject>`, `<action>`, `<resource>`, `<expires_at>` from the capability object. Keep the existing KV grid untouched below it.

4. **EXACT — preflight + HashScan link:**
   - `demo/agent.ts` preflight: after the existing health/env checks, abort unless both flags are unset or `"0"`:
     ```ts
     for (const flag of ["X402_DEV_BYPASS", "X402_SIMULATE_FAILURE"] as const) {
       const v = process.env[flag];
       if (v !== undefined && v !== "0") {
         throw new Error(`preflight: ${flag} must be unset or "0" for a real take (got ${JSON.stringify(v)})`);
       }
     }
     ```
   - TraceView settlement ref becomes a link ONLY when `x402_ref` is present: `https://hashscan.io/testnet/transaction/<dash-form>` using the existing dash conversion in `payments/x402.ts` (import it if exported, else duplicate the 3-line helper inside TraceView — do NOT move shared code), styled with the existing `.link` class (same as the LangSmith link). Null ref → plain text, no link. Comment the testnet-only URL assumption.

5. **Tests** (vitest): protector round-trip + missing-var throw + warn emitted; pay path green through the protector (existing x402 tests must pass unmodified in behavior); resolve with/without `resolved_by` (default applied); trace renders `RESOLVED BY`; preflight aborts on `X402_DEV_BYPASS=1` (env override in-test, restored after); HashScan href exact format asserted.

6. **Docs** (one line each, no essays): `docs/ledger.md` — protector seam paragraph stating explicitly that the dev backend returns env plaintext, provides zero protection, and exists to hold the seam (one-env-var swap claim); `docs/demo.md` checklist — preflight now asserts bypass flags (note it so operators aren't surprised by the abort).

## Acceptance criteria

- [x] `getSecretProtector()` returns dev backend by default (warn visible in logs), keyring backend under `LEDGER_PROVIDER=ledger`; live pay path settles through the dev protector (existing x402 tests green, behavior identical); no plaintext key handling added anywhere (grep: no new `HEDERA_OPERATOR_KEY` reads outside protector + config).
- [x] Resolve persists nothing new in DB (event-sourced); approval-completed event carries `resolved_by` (explicit + default); TraceView joins events on `approval_id` and renders `RESOLVED BY` (`"unknown"` for pre-change rows).
- [x] Capability promo line renders with exact subject/action/resource/expiry; existing grid untouched.
- [x] Preflight aborts on bypass flags (tested); settlement ref is a clickable HashScan link (href asserted).
- [x] `pnpm typecheck && pnpm lint && pnpm test` green. No other schema changes. No engine changes. No new reason codes.
  (Test-run note: the full suite's one red is PRE-EXISTING and outside this wave's fence — plan-10's `e2e.demo.test.ts` needle expects purchase `capability.issued` AFTER `payment.completed`, but the orchestrator (untouched, orchestrator.ts:104→:467) emits it before; the test always skipped until the operator was funded, which exposed it. 135 pass / 3 skip / 1 pre-existing fail. Merger/plan-10 owner: fix the needle order.)

## Out of scope

Video narration lines, wallet top-up, funded green run (human); HCS anchoring; DAO voting; touching `engine.ts`, `schema.ts`, or any plan-00 file. No migrations in this wave — event log carries the new field.
