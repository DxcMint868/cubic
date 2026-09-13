---
guide: .agents/guides/guide-01-bootstrap.md
status: ready
depends-on: [plan-09-frontend]
---

# Plan 16 — UI demo flow: chat, templates, Play, HCS anchors, surfaced branches

**HOW TO USE:** **EXACT** blocks are verbatim contracts — copy them as written. If an EXACT block fails, STOP and report; never silently redesign. Steps are ordered. Context: founder verdict is "scripts demo to machines, UI demos to humans" with ~0.5 days left. This wave is demo-surface only: chat UI, scenario templates, Play mode, history filters, HCS fingerprint anchoring, and templates for already-enforced-but-undemoed branches. No engine/policy/schema/reason-code changes. No new rule types (those ride plan-15 post-video).

## Objective

A human can watch an agent act, see every authorization, replay scenarios in one click, auto-play the video take, verify fingerprints on Hedera, and re-find past runs — all within the existing engine.

## Preconditions

plans 05–11 merged. **Read `DESIGN.md` FIRST** (mandatory for all UI work): monochrome only, `MacWindow` reuse, `.mono` for technical text, Darker Grotesque, outlined-square motif, no color accents. Read `.agents/plans/plan-00-architecture.md` (§B.1, §F event payloads, §G).

## Steps

1. **EXACT — chat transport (MCP client, real protocol):** new `POST /api/demo/chat` route accepts `{message, template_id?, task_id?}`. Template ids resolve to EXACT `{tool, arguments}` with no LLM. Free text goes to new `server/demo/parse.ts` (OpenRouter pinned — `OPENROUTER_API_KEY` + optional `CHAT_MODEL` defaulting to `openai/gpt-4o-mini`; strict JSON `{tool, arguments}` zod-validated against the 5 MCP tool shapes, 8s timeout; any failure/refusal yields `{tool: null}` → display-only no-tool state, gateway never called). Then a fresh-per-call MCP SDK Client (streamable HTTP, `x-cubic-agent` header) hits our own `/api/mcp`: `tools/list` once (cached, "5 tools connected" chip) + `tools/call` per message through the identical orchestrator. Returns `{intent, decision, trace_url, network_url}` in the standard envelope. Provider unset → templates-only mode, free-text box honestly disabled + labeled.

2. **EXACT — turn shape (fixed, every turn):** (1) intent JSON bubble = gateway `NormalizedIntent` verbatim, (2) Decision banner with real reason code using `Decision` + `Allow | Deny | Escalate` language only, (3) capability/execution/payment one-liners where present, (4) trace + network links. Client labeled `Demo agent (MCP client)`. No-tool state: dashed-neutral, plain words "No tool matched — nothing was sent to the gateway", banned from `.mono`, reason styling, trace payloads, e2e assertions. Origin stays `"agent"`.

3. **EXACT — templates** (`server/demo/templates.ts`; each doubles as e2e assertion `{label, chat_text, expected tool/args or no-tool, expected decision+reason}`): deploy story (read PR → scan → merge-escalate → approve), treasury story (swap-escalate → payroll → stake pair), **surfaced branches (zero engine changes — all already enforced, previously undemoed)**: cross-task read (`evil/org` → `resource_outside_task` DENY), unknown tool (`github.delete_repo` → `tool_not_allowed` DENY), capability replay → `replay` reject, expired capability → `expired` reject, treasury drain-reject, deploy-production escalate. Adversarial camera beats: `.env` read (real `secret_resource` DENY) + over-budget (real `budget_exceeded` DENY) ONLY. Slur/off-scope stays an off-camera parser e2e, never the take.

4. **EXACT — `/demo/chat` page** (MacWindow, `.mono`, monochrome): user bubbles, agent-intent JSON bubbles, verdict banners in filled/outlined/dashed states, trace + network links, tools chip, template buttons, free-text box, Play button auto-running a scenario beat-by-beat with literal narration cues from `docs/demo.md`. Scan turn renders inline receipt (amount + `hedera` + short settlement ref); merge turn renders reason + provider badge. Play ends on `/network`. Beat 0 is a title card + voiceover (no raw-agent build).

5. **EXACT — HCS fingerprint anchoring (async projection, never the hot path):** new `server/anchors/hcs.ts` with pure shared helpers `canonicalEnvelope(envelope): string` + `fingerprint(envelope): hex-sha256` (single source of truth for submit AND display — byte-identical by construction). Hook ONE call into the `events/projection.ts` step (same pattern as network_events): for allowlisted types (`policy.evaluated`, `capability.issued|denied|escalated|consumed|rejected`, `payment.completed|failed`, `ledger.approval.completed`, `task.completed`) fire-and-forget submit the fingerprint to the HCS topic; catch-all warn, never throw, never await in the decision path. NO receipt storage (mirror node is the record — zero schema change). Trace API adds derived per-event `anchor: {fingerprint, topic_id}` (computed, not stored); UI renders fingerprint + topic-explorer link. Env: `HCS_TOPIC_ID` (created post-top-up by `pnpm --filter app hcs:init` running `server/anchors/init-topic.ts`; operator key already present). Failure mode is warn-only, always.

6. **History enrichment (small):** tasks table gains outcome + agent filters (audit page already filters — mirror its pattern, no new components); nothing else. No DAG graph (explicitly deferred post-video).

7. **Runbook rewrite** (`docs/demo.md` video section): two-tab format (chat left, console right), 30-second linear flow first, full script second, literal narration cues, wallet top-up + topic-create + rehearse-dev/record-live steps, bypass-flag + keyed/unkeyed-take notes.

8. **Tests** (vitest): chat-route e2e per template; adversarial display; no-provider templates-only; Play beat order; chat-vs-ingest event-identity test (same template through both transports → identical chains); HCS mock tests (fingerprint format, non-blocking failure, hook fires on allowlisted types only); surfaced-branch template tests.

## Acceptance criteria

- [x] Template click → full chain visible <3s with verbatim intent + real reason + trace link.
- [x] Adversarial camera beats → real-DENY banners, zero executions; no-tool state never photographs as a Decision.
- [x] Play mode runs a scenario hands-free end to end, ending on `/network`.
- [x] Free text without provider → honest disabled state; with provider → parsed or cleanly declined.
- [x] HCS: mocked submit fires per allowlisted event with exact fingerprint bytes; failure never blocks or throws; trace shows fingerprint + topic link; topic script documents the top-up prerequisite.
- [x] Tasks filters work; runbook reads 30-seconds-first.
- [x] `pnpm typecheck && pnpm lint && pnpm test` green. No engine/policy/schema/reason-code changes. No new rule types.

## Out of scope (explicit — founder-approved cuts)

Free-roaming agent autonomy, auth, token streaming, voice, second chain, external harness processes, DAG-graph history, simulator/NL-draft/packs (plan-15 post-video), per-message receipt storage, HCS topic management UI.
