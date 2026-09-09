---
guide: .agents/guides/guide-01-bootstrap.md
status: ready
depends-on: [plan-02-gateway-policy]
---

# Plan 07 — The Graph: Agent0/ERC-8004 trust context as a policy fact

## Objective

The Graph becomes load-bearing: agent identity/reputation/validation data from Agent0/ERC-8004 subgraphs flows into policy facts and demonstrably flips decisions.

## Preconditions

plan-02 merged; `AGENT0_SUBGRAPH_URL` set (pick the current published endpoint against live docs); plan-00 §K read.

## Tasks

1. **`graph/agent0.ts`**: GraphQL client (plain fetch + zod): agent lookup by ERC-8004 identity → `{identity, reputation, validation, capabilities[]}`; short-TTL in-memory cache (default 60s) keyed by identity.
2. **`gateway/context/graphProvider.ts`**: `GraphContextProvider implements ContextProvider` — merges subgraph reputation/validation into facts; on error/timeout falls back to neutral facts with a logged warning (deterministic, never throws into the pipeline).
3. **Wiring**: agents with an `erc8004_identity` get graph facts; agents without keep static facts. Provider selected by env (presence of `AGENT0_SUBGRAPH_URL`).
4. **Policy emphasis**: the `reputation_rule` (min 0.80 for autonomous spend / high-risk) now consumes real facts. Seed a low-reputation demo agent variant — a fixture identity routed through the **identical provider interface** (same-pipeline rule), flagged `environment=demo`.
5. **Tests**: reputation 0.95 → allow vs 0.50 → escalate (facts injected through the provider interface — proves the fact is load-bearing regardless of source); outage fallback returns neutral facts and the decision stays deterministic; cache behavior.

## Acceptance criteria

- [ ] A reputation fact obtained through `ContextProvider` demonstrably changes a policy decision (documented test).
- [ ] Subgraph outage degrades to neutral facts with a logged warning; the gateway never crashes on Graph errors.
- [ ] The subgraph endpoint and queries used are documented.
- [ ] Fixture and real data both flow through the identical provider interface; fixtures are flagged demo.

## Out of scope

Substreams live streaming (future), agent-side Subgraph MCP usage (optional future), deploying our own subgraph.
