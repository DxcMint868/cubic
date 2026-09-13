# Hackathon submission answers

Two lengths per question: **full** (if the box allows ~250 words) and
**compact** (if it allows ~120 words). All numbers and claims match the
shipped build.

---

## Q "Describe your project" — full

We built **Cubic**, an authorization gateway for AI agents — think
"Cloudflare for agent actions." AI agents today hold long-lived API keys, so
a single prompt injection turns a helpful assistant into an attacker with
the keys to production. Cubic inverts that: agents never hold credentials.
Instead, every action they attempt is routed through our gateway, turned
into a structured intent, and judged by a deterministic policy engine —
written rules, not another LLM's opinion — which answers **allow, deny, or
escalate**.

Allowed actions receive a scoped capability: permission to do exactly one
thing, on exactly one resource, for five minutes. High-risk actions —
merging code, moving money — escalate to a human, who signs the approval
with their own wallet. Paid services are metered: an agent that needs a
security scan gets a $0.25 quote over the x402 protocol, the gateway checks
the task's budget, and the payment settles in HBAR on Hedera.

Every step — intent, decision, capability, execution, payment, result — is
recorded in an audit chain, and its fingerprints are anchored to Hedera's
Consensus Service, so the record can be proven against the chain rather
than taken on faith.

In the demo, a fictional fintech runs a four-agent workforce: agents read
pull requests, buy scans, attempt to merge and deploy, and get prompt
injection attempts denied in real time.

## Q "Describe your project" — compact

We built **Cubic**, an authorization gateway for AI agents — "Cloudflare
for agent actions." Agents never hold API keys. Every action they attempt is
routed through our gateway, judged by a deterministic policy engine — not an
LLM — and answered with allow, deny, or escalate. Allowed actions get scoped
five-minute capabilities instead of credentials; high-risk actions require a
human wallet signature; paid services are metered, with a $0.25 security
scan settled in HBAR over x402 on Hedera. Every step is recorded and its
fingerprint anchored to Hedera Consensus Service, so the audit trail is
provable, not promised.

---

## Q "How did you build it" — full

Cubic is a TypeScript/Next.js application with three layers: a gateway with
a deterministic policy engine, a tenant console (agents, approvals,
policies, payments, traces), and a public network view fed by the same live
event stream. Agents reach the gateway through the standard MCP protocol —
we expose five tools via an MCP server and consume them through the official
MCP SDK client, so the same decision pipeline serves both transports.

The interesting parts are the three integrations:

**Identity and reputation (The Graph).** Our demo agents are registered
onchain under the ERC-8004 agent-identity standard. Reputation is read live
from The Graph's Agent0 subgraph, and it changes outcomes: one agent is a
contractor with genuine negative feedback onchain, so the gateway escalates
every action it takes. A page in our console shows the exact GraphQL query
and The Graph's verbatim response for any agent, so you can confirm the
trust signal comes from the indexer, not our database.

**Machine payments (Hedera x402).** A security-scanner service answers
`402 Payment Required` with a $0.25 quote. The gateway checks the agent's
task budget policy, settles the payment in HBAR on Hedera testnet through
the Blocky402 facilitator, and records the settlement reference — a real
transaction, viewable on Hedera's HashScan explorer. The agent never touches
a wallet key.

**Human approval, provable (wallet signatures + HCS).** High-risk actions
escalate to approval councils. The approver signs with their own wallet
(EIP-191 personal_sign); the server verifies the signature against the
registered approver address and seals signer + signature into the approval
event. Every audit event is sha256-fingerprinted and submitted to a Hedera
Consensus Service topic; a live verification page recomputes each fingerprint
against the mirror node, so "who approved this, and can I trust the record"
has an onchain answer.

Demo surfaces (repos, pull requests, deploy results) are simulated and
labeled as such on screen. The authorization pipeline, the identities, the
payments, the approvals, and the anchoring are real and were exercised live
while recording the demo.

## Q "How did you build it" — compact

TypeScript/Next.js gateway with a deterministic policy engine, an MCP server
plus SDK client, and a Postgres event-sourced audit chain. Agents hold real
ERC-8004 identities registered onchain; reputation comes live from The
Graph's Agent0 subgraph and changes real decisions (a contractor agent with
genuine negative feedback is escalated on every action). Machine spend goes
over x402: a 402-gated $0.25 security scan settled in HBAR on Hedera testnet
through the Blocky402 facilitator, receipt on HashScan. High-risk actions
escalate to approval councils — the human signs with their wallet, the
signature is verified server-side and sealed into the event's fingerprint,
and every fingerprint is anchored to a Hedera Consensus Service topic with a
live verify page. Simulated surfaces are labeled; the pipeline, identities,
payments, and anchoring are real.
