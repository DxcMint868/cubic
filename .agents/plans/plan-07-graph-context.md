---
guide: .agents/guides/guide-01-bootstrap.md
status: ready
depends-on: [plan-02-gateway-policy]
---

# Plan 07 — The Graph: Agent0/ERC-8004 trust context as a policy fact

**HOW TO USE:** **EXACT** blocks are verbatim contracts — copy them. The subgraph query is spike-light: verify the current Agent0 schema against live docs. Steps are ordered.

## Objective

The Graph becomes load-bearing: agent identity/reputation/validation from Agent0/ERC-8004 subgraphs flows into policy facts and demonstrably flips decisions.

## Preconditions

plan-02 merged; `AGENT0_SUBGRAPH_URL` set to the current published Agent0 endpoint (verify the URL against The Graph's docs — record the chosen endpoint + exact query in your final report).

## Steps

1. **EXACT — `graph/agent0.ts`** interface:

```ts
export interface AgentTrust {
  identity: string;
  reputation: number;                       // 0..1
  validation: "passed" | "failed" | "unknown";
  capabilities: string[];
}
export interface Agent0Client {
  lookup(erc8004Identity: string): Promise<AgentTrust>;   // GraphQL over HTTPS POST + zod-validate AgentTrust
}
```

   In-memory cache: `Map<identity, {value: AgentTrust, expires: number}>`, TTL 60s. GraphQL query fields: verify against the live Agent0/ERC-8004 subgraph schema (reputation + validation are the must-haves); record the final query text in your report.

2. **EXACT — `gateway/context/graphProvider.ts`** (`GraphContextProvider` implementing plan-02's context interface): `getFacts` = same as `StaticContextProvider` EXCEPT `agent_reputation` comes from `agent0.lookup(agent.erc8004_identity).reputation`. **Fallback (EXACT):** any fetch/timeout/validation error → `agent_reputation = 0.80` (neutral) + `console.warn("graph-context-fallback", { identity })`. Never throw into the pipeline. Note: 0.80 sits exactly AT plan-02's `reputation-floor` (`min: 0.80`, applies only when strictly below) — neutral therefore passes by design, and any real `0.79` from the subgraph correctly escalates.

3. **EXACT — provider selection:** `config().AGENT0_SUBGRAPH_URL` is set AND `agent.erc8004_identity != null` → GraphContextProvider; otherwise StaticContextProvider (0.95). No other changes to plan-02's pipeline.

4. **EXACT — fixture (append to `demo/seed.ts` agents only):**

```json
{ "agent_key": "agent:lab-1", "name": "low-rep-research-agent", "environment": "demo",
  "status": "active", "erc8004_identity": "fixture:low-rep",
  "declared_capabilities": ["github.get_pull_request"] }
```

   `GraphContextProvider` contains an EXACT fixture map: `{ "fixture:low-rep": { reputation: 0.50, validation: "unknown", capabilities: [] } }` — real identities go over GraphQL; ONLY this fixture identity short-circuits. Clearly the same interface, flagged demo.

5. **Tests (vitest, plan-02 test-double pattern):** reputation 0.95 → allow; reputation 0.50 → escalate `reputation_below_threshold` (proves the fact is load-bearing); a mocked fetch rejection → neutral 0.80 → allow + warning logged; cache: second lookup within TTL performs zero network calls (mock fetch, assert call count).

## Acceptance criteria

- [ ] A reputation fact obtained through the context provider demonstrably changes a policy decision (the 0.95-allow vs 0.50-escalate test).
- [ ] Graph outage degrades to neutral facts (0.80) with a logged warning; the gateway never crashes on Graph errors.
- [ ] The chosen subgraph endpoint + exact GraphQL query are documented in your final report; fixture data is flagged demo and flows through the identical provider interface.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` green (network tests use mocks; no live subgraph dependency in the test suite).

## Out of scope

Substreams streaming (future), agent-side Subgraph MCP (future), deploying our own subgraph.
