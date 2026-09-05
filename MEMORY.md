# MEMORY.md

## Purpose

This is the project's hot-memory layer: the actively maintained working fact store for agents. It records implementation state, decisions, current tasks, constraints, discoveries, unresolved questions, and project nuances that should survive across agent sessions.

## Agent Instructions

- **MUST read MEMORY.md at the start of every substantive task.**
- **MUST update MEMORY.md when implementation state, architecture, decisions, tasks, constraints, or important technical facts change.**
- Prefer concise, factual entries over prose.
- Record decisions with enough context to prevent later agents from accidentally reversing them.
- Mark stale or superseded facts clearly rather than silently deleting useful history.
- Do not use MEMORY.md as a dump for transient chatter. Keep it useful as working memory.
- When uncertain whether a fact is current, verify it before treating it as authoritative.

## Current State

Update this section as implementation progresses.

### Active Work
- [ ] Define the first end-to-end MVP implementation.
- [ ] Implement the authorization gateway and capability model.
- [ ] Integrate MCP as the tool boundary.
- [ ] Integrate ERC-8004 / The Graph context.
- [ ] Integrate Ledger Key Ring / Agent Stack path.
- [ ] Integrate a live Hedera x402 payment flow.
- [ ] Build tenant control-plane surfaces.
- [ ] Build the global agent-network visualization.

### Decisions
- Monorepo managed with **pnpm workspaces** (root `pnpm-workspace.yaml`).
- `app/` is a Next.js 15 App Router project (React 19, TypeScript 5).
- `contracts/` is a Foundry/Solidity project (forge 1.5.1, solc 0.8.24).
- `pnpm dev` / `pnpm build` / `pnpm typecheck` run app commands from root.
- `pnpm forge:build` / `pnpm forge:test` run contract commands from root.

### Recent Changes
- Git init, monorepo structure, pnpm workspaces, Next.js App Router scaffold, Foundry project scaffold — all verified building clean.

### Important Constraints
- Authorization decisions must be deterministic; LLMs may classify/summarize but must not be the final ALLOW/DENY oracle.
- The gateway should authorize normalized tool operations and must not become an API-adapter zoo.
- Detailed private tenant audit data stays off-chain; blockchain is used selectively for trust, identity, reputation, attestations, payments, and verifiability.
- Ledger hardware security must not be represented as equivalent to a mock/dev implementation.

### Decisions
Record architectural decisions here as they are made.

### Known Issues / Open Questions
Record unresolved implementation questions here.

### Recent Changes
Record the most recent meaningful implementation changes here.
