---
guide: .agents/guides/guide-01-bootstrap.md
status: ready
depends-on: [plan-12-sponsor-hardening]
---

# Plan 13 — Council hardening: error sanitization, revoke events, ledger boot-gate

**HOW TO USE:** **EXACT** blocks are verbatim contracts — copy them as written. If an EXACT block fails, STOP and report; never silently redesign. Steps are ordered. Source: 6-reviewer security council on plan-12 (tracer, security, integration, AI-engineer, contract, PO) — this wave closes the code-owned findings; rotation runbook narrative and video stay human.

## Objective

Close the council's dangerous findings: raw error strings that can carry key material into agent responses, silent revokes, half-broken ledger-backend boot, and unattributed trace links — without touching the security model itself (dev-labeled seam stands).

## Preconditions

plans 05–12 merged. Read `.agents/plans/plan-00-architecture.md` (§B.1, §F event payloads, §G).

## Steps

1. **EXACT — sanitize at the emit boundary** (the tracer's dangerous finding: `orchestrator.ts` purchase catch-all writes raw `err.message` into `failPayment` → event payload → agent response → trace):
   - In `orchestrator.ts`, map unknown throws to a fixed enum BEFORE `failPayment`/event/agent response: `error_code` accepts only a closed set (`SETTLEMENT_ERROR`, `EXECUTOR_ERROR`, `CHALLENGE_UNAVAILABLE`, `PRICE_MISMATCH`, `SERVICE_PAYMENT_REQUIRED`, plus existing codes); anything else becomes `SETTLEMENT_ERROR`. Raw message goes ONLY through the redacting logger server-side, never into `error_code`, `executions.error` persistence for NEW writes, or agent responses.
   - Unify redaction into ONE shared constant (new `server/logging.ts` export, consumed by both `logging.ts` and `ingest.ts`): `/token|secret|password|credential|private[_-]?key|api[_-]?key|operator[_-]?key/i` (covers camelCase holders like `operatorKey`).
   - Remove or justify the `depth > 3` redaction cutoff in `ingest.ts` (either recurse fully or document why 3 is safe — no silent persistence of nested secrets).
   - Tests: the evil twin — throw a fake-secret-bearing error through `runToolCall` and assert it reaches NEITHER `result.data`, NOR events, NOR trace output (only the fixed enum + redacted logs).

2. **EXACT — `capability.revoked` event** (integration finding: revokes are DB-only, invisible on trace/network):
   - `events/types.ts`: add `capability.revoked` with payload `{capability_id, reason: string}` (contract addendum, same precedent as `resolved_by`).
   - Emit it in `verify.ts` on EVERY revoke path (all `revokeCapability` call sites route through one function — emit inside it, not at callers).
   - `events/projection.ts` mapping: `capability.revoked → action_class "authorization", outcome "revoked"`.
   - No UI component changes (surfaces via the existing EVENTS tab + network stream).

3. **EXACT — ledger-backend boot-gate + explicit migration error** (security/integration finding: `LEDGER_PROVIDER=ledger` today half-boots then fails opaquely per payment):
   - On boot when `LEDGER_PROVIDER=ledger`: assert `ringProvisioned()` (cheap local-cache read, no device) and fail fast with an actionable message ("Key Ring not provisioned — run wallet-cli ring init on a device host") instead of serving a half-broken gateway. Gate ONLY under explicit `ledger` selection (dev boot path untouched).
   - Until the operator-key `ring:` migration lands: catch the bare-ref throw and surface `OPERATOR_KEY_NOT_PROTECTED` (not generic `SETTLEMENT_ERROR`), with the cause logged server-side.

4. **EXACT — reasoning_ref origin label** (AI-engineer finding: client-supplied refs render as trusted links):
   - Persist `origin: "client-supplied" | "server-minted"` alongside the ref (inside the existing `reasoning_ref` object — no schema change).
   - TraceView renders client-supplied links with a `CLIENT` tag distinct from server-minted ones. Server assist path sets `"server-minted"`.

5. **Tests** (vitest): evil-twin canary; revoked-event emission on all revoke paths + projection row; boot-gate aborts under ledger-without-ring and passes otherwise; migration-error code asserted; origin labels render distinctly.

6. **Docs** (one line each): `docs/ledger.md` — key-compromise runbook (rotate at Hedera → update every `.env.local` + demo shell → restart ALL gateway processes due to config memoization → preflight → audit `payments`/`audit_events` for rogue settlement refs in the window; state plainly what you can NOT do: revoke signatures, claw back, rotate without downtime) + exposure-window query (exact SQL sketch for settlements in a time window).

## Acceptance criteria

- [x] Fake-secret error through `runToolCall` reaches no agent surface, no event, no trace row (only fixed enum + redacted logs); shared regex covers camelCase; depth cutoff resolved. (hardening13.test.ts evil-twin canaries, green)
- [x] Every revoke emits `capability.revoked`; projection row appears; trace EVENTS tab shows it. (hardening13 + capability tests, green)
- [x] `LEDGER_PROVIDER=ledger` without ring → boot fails fast with actionable message; bare-ref pay fails as `OPERATOR_KEY_NOT_PROTECTED` with server-side cause. (unit tests green + LIVE `next dev` probe: server logs the EXACT message and exits; normal dev boot 200)
- [x] `origin` labels persist + render distinctly; server path sets `server-minted`. (SSR render tests + mocked-SDK write-side test, green)
- [x] `pnpm typecheck && pnpm lint && pnpm test` green. No schema changes. No engine changes. No new reason codes. No behavior change on happy paths (full suite green proves it). — typecheck clean; lint exit 0 (2 pre-existing warnings); suite 155 pass / 2 skip / 1 pre-existing env-gated failure (treasury live-key: LANGSMITH_API_KEY 401s on /runs in this worktree; fails identically with plan-13 changes reverted — not this wave's regression; key needs refresh). Schema/engine/reason-codes untouched; full green elsewhere proves happy paths.

## Out of scope

Ring-ref migration of the operator key (needs provisioned device — human-gated, stays documented-blocked); per-agent keys/KMS/session creds (rejected scope); key zeroization (Node gives no tools); trace-route auth (prod scope); HCS anchoring; video/narration/top-up (human).
