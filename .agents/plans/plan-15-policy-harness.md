---
guide: .agents/guides/guide-01-bootstrap.md
status: proposed
---

# Plan 15 (PROPOSAL, post-video) — Policy harness: AI drafts, humans sign, math enforces

**Status: proposed. Do NOT dispatch before the video shoot.** This is the vision answer to "who writes the rules" — filed now so the idea doesn't rot, built after camera.

## Thesis (the pitch line)

Everyone else puts the AI in the judge's chair, where attackers can sweet-talk it — our Beat 6 demo proves that attack live. We put the AI in the clerk's office drafting paperwork, a human signs it, and math enforces it. **AI proposes, humans approve, math enforces.** The deterministic engine (waves W1–W2) never changes; everything below is harness *around* it, never an LLM in the hot path.

## The three layers (and what exists today)

1. **Enforcement core — BUILT.** Deterministic `evaluate()`, versioned rule JSON, full audit. The moat: no prompt injection can talk it out of a deny, because there is no mind to change.
2. **Authoring harness — NEW.** Tenant describes intent in plain words ("my deploy agent may merge to staging, never touch prod secrets, never spend over $5") → LLM drafts rule JSON → **simulator** replays the draft against the tenant's own recorded audit history ("would have allowed X, denied Y, escalated Z") → human approves → versioned, signed, deployed. AI does translation; human holds the pen.
3. **Community packs — NEW.** Versioned, signed, forkable rule packs with publisher identity (ERC-8004 — dogfood our own trust layer) + adoption stats. "Install DeFi-treasury-baseline v3, fork it, audit the diff." The network-effect story: Cloudflare WAF rules, OPA libraries, npm.
4. **Learning loop — NEW, with a hard guardrail.** Denied/escalated clusters + operator overrides surface as *proposals* ("3 similar denials this week — draft a rule?"), never auto-applied. Stated anti-pattern, non-negotiable: auto-tuning enforcement from traffic is prompt-injection into policy by another name.

## Build order (when dispatched, in this order — each leaves the repo runnable)

1. **Simulator** (small): `POST /api/policies/dry-run {policy, task_id?, window}` → runs `evaluate()` over historical intents, returns allow/deny/escalate counts + the 10 most consequential flips vs current policy. Read-only, zero enforcement impact. This alone is demoable ("watch what this rule would have done to last week's traffic").
2. **NL-draft endpoint** (thin): `POST /api/policies/draft {text}` → LLM returns rule JSON + a plain-words back-translation ("here's what I understood — correct me"), always routed through the simulator before it can be saved.
3. **Packs model** (medium): `policies` gains publisher/signature/version installs; console UI lists/installs/forks packs with diffs; pack rules evaluate through the identical engine (no second interpreter — ever).

## Acceptance criteria (for the dispatching wave)

- [ ] Draft → simulate → approve → enforce loop runs end to end on a tenant, with the simulator's counts matching a hand-audit of 20 sampled intents.
- [ ] A hostile prompt-injection attempt against the DRAFT endpoint cannot alter any enforced rule (drafts are inert until approved + versioned).
- [ ] Pack install/fork round-trips byte-identical rule JSON; engine evaluates pack rules and local rules with zero behavioral difference.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` green. No engine-semantics changes. No LLM in `evaluate()` or the approval path — assert structurally (test imports).

## Out of scope (forever, not later)

LLM in the final decision; auto-applied learned rules; a second policy interpreter for packs; anything that weakens the deterministic core for convenience.
