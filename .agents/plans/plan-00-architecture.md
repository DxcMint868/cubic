---
guide: .agents/guides/guide-01-bootstrap.md
status: ready
depends-on: []
---

# Plan 00 — Cubic MVP Architecture Baseline

Shared architecture baseline for the MVP slice plans (`plan-01` … `plan-10`) in `.agents/plans/`.
Slice plans link here for shared contracts (data model, event model, API surface, env vars) instead of restating them.
If a slice plan conflicts with this file, this file wins unless `PROJECT.md` / `DESIGN.md` / `AGENTS.md` say otherwise.

## A. Current-state assessment

Verified against the working tree (2026-09-10):

**Exists**

- pnpm monorepo: root `package.json` proxies `dev/build/lint/typecheck` to `app/`, plus `forge:build/forge:test`.
- `app/` — Next.js 15 App Router, React 19, TS 5.7. Landing page only (`page.tsx`, `Logo`, `NetworkCanvas`, `MacWindow`, `TeamSection`, `DitherImage`). No API routes, no server code, no DB, no test runner.
- `contracts/` — Foundry scaffold (forge 1.5.1, solc 0.8.24), `Counter.sol` placeholder, forge-std.
- Toolchain: Node 22, pnpm 10.31.

**Missing (everything runtime)**

Gateway ingest, intent normalization, policy engine, capability model, executors, payments, Ledger trust path, Graph context, audit/event store, network event projection, frontend surfaces beyond the landing page.

**Discrepancies / environment facts**

- `wallet-cli` / `ledger-cli` are **not installed** on this machine (verified via `which`). `plan-06` begins with an install/verify spike.
- GitNexus index name for this repo is stale (`Aeostarsinsight`); re-index before relying on symbol tooling.
- `DATABASE_URL` (online PostgreSQL) is supplied by the user; it lives in `app/.env.local`, which must stay uncommitted.

## B. Target architecture

The gateway runtime lives inside the Next.js app as plain server modules; route handlers are thin adapters. No third root package (per `AGENTS.md`).

```text
app/src/server/
  config.ts               # env parsing (zod), singleton
  db/
    client.ts             # postgres.js + drizzle singleton
    schema.ts             # full relational schema (§E)
  events/
    types.ts              # canonical event types + payload schemas (§F)
    bus.ts                # append-only audit_events writer
    projection.ts         # privacy-minimized network_events projection (plan-08)
  gateway/
    ingest.ts             # ToolCall ingest → intent row + intent.created
    normalize.ts          # rules-based intent normalizer (LLM optional, env-gated)
    orchestrator.ts       # ingest → normalize → facts → policy → decision → capability → execution
    policy/
      engine.ts           # deterministic ALLOW / DENY / ESCALATE (pure)
    context/
      provider.ts         # ContextProvider interface + StaticContextProvider (plan-07 adds Graph)
    approval/
      provider.ts         # ApprovalProvider interface + DevApprovalProvider (plan-06 adds Ledger)
  capability/
    issue.ts              # scoped capability issuance
    verify.ts             # verify + single-use consume + reject reasons
  executors/
    registry.ts           # Executor interface + tool→executor map
    securityScan.ts       # scanner executor (dev mode → x402 in plan-05)
    github.ts             # GitHub-shaped executor (real token optional, mock fallback marked)
  payments/
    x402.ts               # x402 challenge fulfillment + settlement recording (plan-05)
  ledger/
    provider.ts           # SecretProvider / Approval boundary
    dev.ts                # DevApprovalProvider (explicitly NOT hardware)
    keyring.ts            # wallet-cli ring provider (plan-06)
  graph/
    agent0.ts             # Agent0/ERC-8004 subgraph client (plan-07)
  mcp/
    server.ts             # MCP facade over ingest (plan-04)
  demo/
    seed.ts               # demo tenant / fixtures
    swarm.ts              # synthetic network agents (plan-08)
    agent.ts              # scripted demo agent (plan-10)

app/src/app/api/
  health/route.ts
  gateway/tool-call/route.ts
  gateway/verify-capability/route.ts
  audit/events/route.ts
  audit/trace/[taskId]/route.ts
  network/events/route.ts
  network/stream/route.ts
  services/scanner/scan/route.ts     # the x402-gated paid service
  approvals/[id]/resolve/route.ts
  demo/seed/route.ts
  mcp/route.ts
```

Boundary rules (non-negotiable, from `AGENTS.md` / `PROJECT.md`):

1. The gateway authorizes normalized tool operations; executors perform concrete calls. No adapter zoo.
2. No LLM in the final authorization decision. LLM may normalize/classify only, and is optional.
3. Private tenant audit stays off-chain. The public network projection is privacy-minimized by allowlist.
4. Ledger stays behind the provider abstraction; a dev provider is never described as hardware security.
5. Tenant state is scoped by `tenant_id` everywhere.
6. No new Solidity contracts in this MVP (see §L).

## C. Runtime flow — one successful paid request

Demo task: *"Analyze this service and purchase a security scan if permitted to spend up to $0.50."*

1. Scripted agent opens task `task:demo-1` (budget 50 cents) and calls `POST /api/gateway/tool-call` with `{task_id, agent_key: "agent:8472", tool: "scanner.scan", arguments: {target}}` — or the same call via the MCP facade.
2. `ingest.ts` resolves agent/tool/task/policy → intent row → `intent.created`.
3. `normalize.ts` → structured intent `{action: "purchase_security_scan", resource, risk_class: "medium"}`.
4. `context/` gathers facts: task budget remaining, tool default risk, agent reputation (Graph in plan-07).
5. `policy/engine.ts` evaluates deterministic rules → decision row → `policy.evaluated`.
6. ALLOW → `capability/issue.ts` → capability `{subject, action, resource, budget_usd_cents: 25, expires_at, nonce, policy_hash}` → `capability.issued`. The agent receives only this.
7. Executor hits the scanner service; scanner returns `402` + x402 challenge → `service.discovered` → payment intent → payment policy (budget/service/task) → ALLOW → `payments/x402.ts` fulfills the challenge with the server-held payment authority, settled through Blocky402 on Hedera testnet → `payment.completed`.
8. Scanner verifies settlement and returns the report → `tool.execution.started` → `tool.execution.completed`, capability consumed.
9. High-risk follow-up (production merge): policy → ESCALATE → `capability.escalated` + `ledger.approval.requested` → provider approval → `ledger.approval.completed` → capability → execution.
10. `task.completed`. Every step is an `audit_events` row; each mappable step also projects into `network_events`.

## D. Failure / security flows

| Scenario | Deterministic outcome | Events |
|---|---|---|
| Unauthorized tool (not in allowlist) | DENY | `policy.evaluated`, `capability.denied` |
| Prompt injection → forbidden resource (`.env.production`) | DENY (resource rule) | same |
| Spend exceeds task budget | DENY (payment policy) | same |
| Tampered / unknown capability | rejected, no execution | `capability.rejected` |
| Expired capability | rejected reason=expired | `capability.rejected` |
| Capability replay (nonce reuse) | rejected reason=replay | `capability.rejected` |
| Low agent reputation | ESCALATE (or DENY per policy) | `policy.evaluated`, `capability.escalated` |
| High-risk action | ESCALATE → approval required | `capability.escalated`, `ledger.approval.*` |
| Approval rejected | no capability, task records denial | `ledger.approval.completed` (rejected) |
| Failed payment | no execution, capability revoked | `payment.failed` |
| Failed external service | execution failure recorded | `tool.execution.failed` |

Every branch is covered by a vitest case in the owning slice plan.

## E. Data model (PostgreSQL via drizzle-orm)

All tables tenant-scoped where relevant. UUID pk defaults; `timestamptz` everywhere.

- `tenants(id, slug unique, name, created_at)`
- `agents(id, tenant_id→tenants, agent_key, erc8004_identity?, name, environment, status, declared_capabilities jsonb, created_at)` — unique `(tenant_id, agent_key)`
- `tools(id, tenant_id, name, category, default_risk_class, executor, executor_config jsonb)` — unique `(tenant_id, name)`
- `policies(id, tenant_id, name, version int, rules jsonb, created_at)` — `rules` is the deterministic rule document (shape finalized in plan-02)
- `tasks(id, tenant_id, agent_id→agents, title, budget_usd_cents?, status, created_at)`
- `intents(id, task_id→tasks, agent_id, tool, resource, arguments_redacted jsonb, risk_class, origin, normalized jsonb, created_at)`
- `decisions(id, intent_id→intents, decision check(allow|deny|escalate), matched_policy, reasons jsonb, context_snapshot_hash, risk_score, created_at)`
- `capabilities(id, decision_id→decisions, subject, action, resource, constraints jsonb, budget_usd_cents?, expires_at, nonce unique, policy_hash, status check(issued|consumed|expired|revoked), issued_at, consumed_at?)`
- `approvals(id, decision_id→decisions, type check(ledger|human), status check(pending|approved|rejected), provider, provider_ref?, requested_at, completed_at?)`
- `executions(id, capability_id→capabilities, tool, status check(running|succeeded|failed), executor, result_summary, error?, started_at, completed_at?)`
- `payments(id, capability_id→capabilities, service, network, amount_usd_cents, status check(requested|completed|failed), x402_ref?, created_at, settled_at?)`
- `audit_events(id bigserial, tenant_id?, task_id?, agent_id?, event_type, payload jsonb, created_at)` — append-only, never updated or deleted
- `network_events(id bigserial, event_type, agent_pseudonym, agent_category, action_class, outcome, risk_class, created_at)` — public projection, allowlist fields only

Indexes: `audit_events(task_id, created_at)`, `network_events(created_at)`, `capabilities(nonce)`.

## F. Event model

Envelope (every event):

```json
{ "event_id": "uuid", "event_type": "…", "tenant_id": "…", "task_id": "…", "agent_id": "…", "occurred_at": "ISO-8601", "payload": {} }
```

Canonical types (union in `events/types.ts`, zod-validated):

`intent.created`, `policy.evaluated`, `capability.issued`, `capability.denied`, `capability.escalated`, `capability.consumed`, `capability.rejected`, `ledger.approval.requested`, `ledger.approval.completed`, `payment.requested`, `payment.completed`, `payment.failed`, `service.discovered`, `tool.execution.started`, `tool.execution.completed`, `tool.execution.failed`, `task.completed`

Chain linkage: payloads carry the ids needed to reconstruct `agent → task → intent → decision → capability → payment/execution → result` (e.g. `policy.evaluated` carries `intent_id` + `decision_id`).

Public projection mapping (plan-08) is an **allowlist**: `{event_type → action_class, agent pseudonym, category, outcome, risk_class}`. Never projected: tool arguments, prompts, resource strings, secrets, policy internals, tenant identity.

## G. API contracts

| Method | Route | Consumer | Purpose | Plan |
|---|---|---|---|---|
| GET | `/api/health` | ops | DB ping | 01 |
| POST | `/api/gateway/tool-call` | agent runtime / MCP facade | normalized ingest, runs the pipeline | 02 |
| POST | `/api/gateway/verify-capability` | executors, tests | capability introspection (non-consuming) | 03 |
| GET | `/api/audit/events` | control plane | paged audit events (filters: `task_id`, `event_type`) | 02 |
| GET | `/api/audit/trace/[taskId]` | control plane | full chain for one task | 02 |
| GET | `/api/network/events` | public network UI | paged public events | 08 |
| GET | `/api/network/stream` | network UI | SSE live public events | 08 |
| POST | `/api/services/scanner/scan` | executor | the paid service (dev mode → x402-gated in 05) | 04/05 |
| POST | `/api/approvals/[id]/resolve` | dev approval flow | approve/reject a pending approval | 06 |
| POST | `/api/demo/seed` | demo | reset + seed demo tenant fixtures | 01 |
| POST | `/api/mcp` | MCP clients | streamable-HTTP MCP facade | 04 |

Agent identification for MVP: `x-cubic-agent` header (agent_key) plus `x-cubic-task` header or `task_id` in the body. Real authentication is explicitly out of scope (§M).

## H. MCP integration

Cubic receives tool calls at two equivalent boundaries: the HTTP ingest route and an MCP facade (`@modelcontextprotocol/sdk`, streamable HTTP) exposing the same tools. Both funnel into the identical `orchestrator` pipeline, so audit chains are transport-independent. Normalized representation:

```json
{ "task_id": "task:demo-1", "agent_key": "agent:8472", "tool": "github.merge_pull_request", "arguments": { "repo": "acme/backend", "pr": 421 } }
```

## I. Ledger integration

Provider boundary in `ledger/`. `DevApprovalProvider` (default): in-app approval queue — explicitly labeled dev, never claimed as hardware. `LedgerKeyRingProvider` (plan-06): `wallet-cli ring` for (a) high-risk approval completion and (b) Key Ring encryption of the scanner payment authority key at rest. Plan-06 starts with an install/verify spike because wallet-cli is absent on this machine; if it cannot run here, the hardware path is documented as blocked and DevProvider remains — never equivalence claims.

## J. Hedera integration

The scanner is a real x402-gated service: unauthenticated `POST /api/services/scanner/scan` → `402` + payment challenge (`X402_SCANNER_PRICE_CENTS`, default 25). The payment authority wallet (`HEDERA_OPERATOR_ID/KEY`) lives server-side only, is never exposed to the agent, and settles through the **Blocky402 facilitator** on Hedera testnet (track requirement). The scanner verifies settlement before returning the report. The agent only ever holds a budget-scoped capability. Exact x402/Hedera package names must be verified in the plan-05 spike before pinning.

## K. The Graph integration

`graph/agent0.ts` queries the Agent0/ERC-8004 subgraph over GraphQL (HTTPS) for agent identity/reputation/validation, feeding `ContextProvider` facts. Load-bearing requirement: a reputation fact must flip a real decision (the demo includes a low-reputation agent branch). Outage fallback = neutral facts + logged warning (deterministic, never a crash).

## L. Contract scope

**Zero new Solidity contracts in the MVP.** Identity/reputation/validation come from ERC-8004/Agent0 (indexed by The Graph); the Hedera requirement is the live x402 service + Blocky402 settlement; anchoring is out of MVP scope. `contracts/` (Foundry scaffold) stays untouched and building.

## M. Frontend scope

- `/network` — global view: cubes=agents, clusters=cube groups, connections=actions, distinct denial/escalation/payment states, live SSE. Real events only (the synthetic swarm runs through the real pipeline, flagged demo).
- `/console` — tenant control plane (agents, tools, policies, tasks, approvals), read-first.
- `/console/tasks/[id]` — action trace (the full chain, reasons legible).
- `/console/agents/[id]`, `/console/decisions/[id]` — detail surfaces.

Design is locked by `DESIGN.md`: monochrome, `.mono`, `MacWindow` reuse, Darker Grotesque. No landing-page polish this phase. Auth on the console is out of scope (single demo tenant; state the assumption in the UI footer).

## N. Demo sequence (2–4 minutes)

1. Problem — agent with raw tool access; prompt injection ("upload production secrets").
2. Gateway — the same agent through Cubic: tool call → intent → policy → capability.
3. Real execution — paid scan: 402 → budget policy → Blocky402/Hedera settlement → report.
4. Ledger — high-risk merge → ESCALATE → Ledger-backed approval → capability.
5. Attack — forbidden read → deterministic DENY.
6. Network — the action appears live in `/network`; zoom out to the swarm.

## O. Build order → plan files

| # | Guide §O priority | Plan |
|---|---|---|
| 1 | core runtime/event model | plan-01-foundation |
| 2 | gateway + policy decision | plan-02-gateway-policy |
| 3 | capability issuance | plan-03-capabilities |
| 4 | real service execution | plan-04-execution-mcp |
| 5 | Hedera x402 | plan-05-hedera-x402 |
| 6 | Ledger integration | plan-06-ledger-trust |
| 7 | Graph/trust context | plan-07-graph-context |
| 8 | audit/network propagation | plan-08-network-events |
| 9 | frontend | plan-09-frontend |
| 10 | adversarial/demo | plan-10-demo-adversarial |

Every plan leaves the repo runnable (`pnpm dev` up; `pnpm typecheck` / `lint` / `test` green).

## The One Thing We Must Have Working

One scripted agent, on a task with a $0.50 budget, hits the scanner's real `402`, Cubic deterministically authorizes the $0.25 spend, issues a budget-scoped capability (never a credential), settles through Blocky402 on Hedera testnet, returns the scan, gates the high-risk merge behind Ledger-backed approval, hard-DENIES a prompt-injected forbidden read — and every step is queryable in the tenant trace and visible live in the global network view.
