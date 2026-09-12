---
guide: .agents/guides/guide-01-bootstrap.md
status: ready
depends-on: [plan-10-demo-adversarial]
---

# Plan 11 — AgentGate mesh: LangSmith reasoning links + treasury demo branch + PO polish

**HOW TO USE:** **EXACT** blocks are verbatim contracts — copy them as written. If an EXACT block fails, STOP and report; never silently redesign. Steps are ordered. Source: deep-dive of the AgentGate repo (prior community-vote winner) — mesh only what transfers, no scope creep.

## Objective

Graft AgentGate's three prize-winning traits onto Cubic without touching its architecture: (1) linked AI reasoning traces per intent, (2) a capital-management demo branch with the killer same-action-different-outcome pair, (3) the carried plan-09 polish items. Zero backend redesign; schema stays frozen.

## Preconditions

plans 05–10 merged. Read `.agents/plans/plan-00-architecture.md` (§B.1, §F, §G).

## Steps

1. **Deps** (`app/package.json` append only): `langsmith@^0.7.1` (the exact package AgentGate uses). Env (already in `app/.env.example`): `LANGSMITH_API_KEY` optional, `LANGSMITH_PROJECT` default `"cubic-demo"`.

2. **EXACT — reasoning ref plumbing (no schema change — `schema.ts` is frozen):**
   - `ToolCall.arguments` may carry `reasoning_ref?: { run_id: string; share_url: string | null; model?: string }` (client passthrough, zod-optional; AgentGate's `reasoning_ref` shape).
   - `NormalizedIntent` gains ONE optional field (the single sanctioned `domain.ts` addition — record as contract addendum in your report):
     ```ts
     reasoning_ref?: { run_id: string; share_url: string | null; model?: string } | null;
     ```
   - Ingest copies `arguments.reasoning_ref` into `normalized.reasoning_ref` (never into `arguments_redacted` output beyond the existing redaction rules).
   - New `server/reasoning/langsmith.ts`: when `LLM_INTENT_PROVIDER` is set, wrap the classifier call in `traceable({ name: "cubic.intent.normalize", project_name: LANGSMITH_PROJECT })`, capture `getCurrentRunTree()?.id`, best-effort `shareRun(runId)` (catch → `share_url: null`), and fill `normalized.reasoning_ref`. Rules-only path (or missing key) → `reasoning_ref: null`. No key, no throw, no mock links — EVER.
   - `intent.created` payload schema UNCHANGED (plan-00 §F frozen); the ref travels in `intents.normalized` and surfaces through the trace API's intent objects.
   - TraceView: render `View AI Trace (LangSmith)` linking `share_url ?? https://smith.langchain.com/runs/<run_id>` when present; render nothing when null.

3. **EXACT — treasury branch (classification, not engine changes):** append EXACTLY these rows to the `normalize.ts` mapping (same arg-based classification precedent as the secret-path rule — no engine edits, no new reason codes):

```text
treasury.swap      → action "treasury_swap",     resource `treasury/${args.asset_pair}`, risk high
treasury.transfer  → action "treasury_transfer", resource `treasury/${args.destination}`, risk high
treasury.stake     → action "treasury_stake",    resource `treasury/${args.protocol}`,
                      risk = (Number(args.amount_usd_cents ?? 0) >= 10000 ? "high" : "medium")
resource_class: "normal" for all three (no secret/cross-task semantics here)
```

   The existing `risk-approval` rule does the rest: the 0.5 ETH stake allows, the 50 ETH stake escalates — the killer pair with zero new machinery.
   - New `executors/treasury.ts` (dev-mode, explicitly labeled): deterministic receipts `{ action, amount_usd_cents, verdict: "simulated", mode: "dev" }`, summaries `"Treasury <action> <amount> (dev mode)"`. Register `treasury.swap|transfer|stake` → it.
   - Seed (by exception, fixture payloads only): append the three tools (category `"treasury"`, risks high/high/medium, executor `"treasury"`), append them to `default-v1`'s allowlist, append `agent:8472`'s declared capabilities, add a treasury task (`budget_usd_cents: 50000`, title names the $3M treasury context).
   - New `demo/treasury.ts` (`pnpm --filter app demo:treasury`): swap $240k → escalate → approve → capability → execution; payroll transfer; stake pair split; $450k swap DENY with reason; prints trace URL. Mirrors `demo/agent.ts` assertion style.
   - New `app/tests/treasury.test.ts`: chain assertions for the four beats above (no new e2e file edits).

4. **Carried PO polish (all small, all explicit):**
   - Delete dead mocks ONLY after verifying zero importers: `app/src/data/agents.ts`, `app/src/data/console.ts`, `app/src/components/AgentGraph.tsx`.
   - Unify `AUTHORIZED` → `ALLOWED` (`network/page.tsx:200`, `HeroCopy.tsx:31` — the only two chromatic-word strays).
   - Wrap `AgentDetail.tsx` + `DecisionDetail.tsx` in `MacWindow`/`Panel` like their siblings.
   - Demo outputs print the console URL too: `demo/agent.ts` finale + `POST /api/demo/run` response + `docs/demo.md` (append `, /console/tasks/<id>` next to each trace URL mention).

5. **Docs**: `docs/demo.md` treasury section (beats, commands, same honesty rules); `docs/payment-flow.md` untouched.

## Acceptance criteria

- [ ] LLM-assisted intent with key set → `normalized.reasoning_ref` persisted with real `run_id`; trace API returns it; TraceView renders the link. Key absent → `null`, no link, no throw, no mock URL (all three asserted in tests).
- [ ] Treasury: $240k swap escalates (`risk_requires_approval`) → approve → capability → execution; payroll same path; 0.5 ETH stake allows while 50 ETH escalates (same action, asserted side by side); $450k-style oversized swap DENIES with a legible reason; `demo:treasury` runs green.
- [ ] PO polish: dead files gone with zero broken imports; no `AUTHORIZED` string remains in product surfaces; both detail cards in `MacWindow` chrome; demo outputs print both URLs.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` green. No `schema.ts` changes. No engine changes. No new reason codes.

## Out of scope

HCS/hash anchoring (deferred mesh — needs its own spike), DAO voting, JWT grants (capabilities are the superior primitive), second-chain support.
