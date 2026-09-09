You are the principal architect/planner for the Cubic project.

Your job is NOT to start coding immediately. First, deeply understand the existing repository and then produce a detailed, implementation-ready execution plan for the next phase.

## Mandatory context loading

From the repository root, read these files FIRST:

1. `AGENTS.md`
2. `PROJECT.md`
3. `DESIGN.md`
4. `MEMORY.md`

Then inspect the actual repository structure and existing implementation under:

* `app/`
* `contracts/`
* root `package.json`
* `pnpm-workspace.yaml`
* existing configs, routes, components, server code, and contracts

Treat `PROJECT.md` as the product source of truth, `DESIGN.md` as the visual/product language source of truth, and `MEMORY.md` as the current working-state/fact/task memory.

Do not trust documentation blindly. Compare it with the actual code and explicitly identify discrepancies.

## Current product state

Cubic is conceptually:

> Cloudflare for agent actions.

The product is an authorization/control layer sitting between AI agents and the tools/services they can use.

Core flow:

`Agent → MCP/tool call → Cubic Gateway → intent/policy/risk evaluation → capability → executor/service`

Cubic should NOT become another Composio-like integration zoo. Existing MCP servers, Composio integrations, APIs, and services should remain responsible for actually executing tool-specific operations. Cubic owns authorization, policy, capabilities, trust/context, auditability, and the network view.

There are two major product surfaces:

### 1. Tenant Control Plane

Each organization configures:

* agents / identities
* policies
* tools
* risk levels
* spending limits
* approval requirements
* context sources
* audit records

### 2. Global Agent Network

A public/network-facing visualization showing aggregate activity:

* agents
* clusters
* actions
* tool/service categories
* authorization events
* denials
* escalations
* payments
* reputation/trust signals
* live network events

This is the wow factor, but it must be backed by the same real event model used by the actual gateway. Do not build a fake disconnected animation.

## Hackathon strategy

The core ecosystem integrations are:

### Ledger

Ledger is the hardware-backed trust/approval/secret-protection primitive.

The architecture should abstract it behind a provider interface.

Target direction:

`Gateway → high-risk decision → Ledger-backed trust/approval → capability/execution`

The project should genuinely integrate with the Ledger Agent Stack and particularly `wallet-cli ring` where supported. Do not claim a fake mock is equivalent to hardware security.

### The Graph

The Graph provides live trust/context/network intelligence.

Use relevant Graph products meaningfully, especially:

* Agent0 / ERC-8004 indexed data
* Subgraph MCP
* standardized subgraphs where useful
* Substreams if useful for real-time event/context flows

The Graph must influence decisions, discovery, reputation/context, or the live network experience. Do not merely query data and print it.

### Hedera

Hedera is now a core MVP integration.

Implement a real x402-gated service on Hedera and make the agent consume it through Cubic.

The paid service should be something useful to the actual task, preferably:

`security scan / risk analysis / intelligence API`

Example:

`$0.25 per request`

The agent discovers the service, receives a payment challenge, asks Cubic whether it is permitted to spend for that service/task/budget, executes the authorized payment flow, receives the result, and continues its task.

Hedera x402 is therefore not a side demo. It is a real consequence of Cubic's authorization decision.

## The vertical slice we need now

Design the smallest end-to-end implementation that proves:

1. An agent exists.
2. The agent has an identity.
3. The agent performs a real task.
4. The agent issues a real tool/service request.
5. Cubic converts/normalizes the request into a structured intent.
6. Cubic evaluates identity + context + policy + risk.
7. Cubic produces:

   * ALLOW
   * DENY
   * ESCALATE
8. If allowed, Cubic issues a narrowly scoped capability.
9. The agent does NOT receive an unrestricted API/payment secret.
10. The authorized operation reaches a real service.
11. At least one meaningful operation uses Hedera x402.
12. The sensitive/high-risk path has a genuine Ledger integration path.
13. Every step is recorded as structured audit events.
14. The same events feed the global network visualization.

## Recommended demo task

Prefer one coherent task rather than several disconnected integrations.

Suggested task:

> "Analyze this protocol/service and purchase a security/risk scan if the agent is permitted to spend up to $0.50."

Possible flow:

`agent discovers service`
→ `x402 402 response`
→ `Cubic parses payment intent`
→ `policy checks budget/service/task/agent`
→ `reputation/context lookup`
→ `risk classification`
→ `ALLOW or ESCALATE`
→ `Ledger-backed sensitive authorization path`
→ `Hedera payment`
→ `service returns analysis`
→ `agent continues`
→ `Cubic records result`

Also include a malicious/prompt-injection branch where the agent attempts something outside its allowed capability and Cubic produces a deterministic DENY.

## Critical architectural rule

Do NOT put an LLM in the final authorization decision.

AI may help with:

* intent extraction
* task classification
* task summarization
* semantic normalization
* risk signals

But final authorization must be deterministic and policy-driven.

Example:

`raw agent request → AI structured intent → deterministic policy engine → decision`

## Capability model

Design a minimal, explicit capability model.

A capability should constrain at least:

* subject/agent
* action
* resource/service
* budget if applicable
* expiration
* nonce or replay protection
* relevant policy/version reference

The capability should represent delegated authority, not a reusable credential.

## Audit model

Design one canonical event schema.

At minimum distinguish:

* intent.created
* policy.evaluated
* capability.issued
* capability.denied
* capability.escalated
* ledger.approval.requested
* ledger.approval.completed
* payment.requested
* payment.completed
* tool.execution.started
* tool.execution.completed
* tool.execution.failed
* task.completed

Every event should contain enough information to connect:

`agent → task → intent → decision → capability → execution → result`

The private tenant audit record may be detailed.

The public/global network event must be privacy-minimized and must never expose:

* secrets
* private prompts
* proprietary runbooks
* sensitive tool arguments
* tenant-private information

## Global network model

Do not build the network visualization as a fake frontend-only animation.

Define a backend/event model first.

The global page should consume real events generated by the actual gateway.

For the hackathon, synthetic demo agents/events are acceptable as long as they use exactly the same event pipeline as real events and are clearly identified as demo/test activity where appropriate.

The visual system should make the metaphor obvious:

`agents = cubes`
`clusters = cube groups`
`actions = connections/events`
`authorization = gate/flow state`
`payments = transaction events`
`reputation = trust signal`

## Blockchain role

Do not put the complete operational audit log on-chain.

Use blockchain infrastructure where it actually provides value:

* identity
* reputation
* validation
* attestations
* payment settlement
* verifiable references / anchoring

Keep detailed operational telemetry off-chain.

## Architecture deliverables

Before implementation, produce a concrete plan containing:

### A. Current-state assessment

What already exists and what is missing.

### B. Target architecture

Actual modules/packages/files and their responsibilities.

### C. Runtime flow

Trace one complete successful request from agent input to service result.

### D. Failure/security flows

Trace:

* unauthorized tool call
* exceeded spending limit
* invalid capability
* expired capability
* low reputation
* prompt injection
* high-risk action requiring escalation
* failed payment
* failed external service

### E. Data model

Define the minimum database/storage schema.

### F. Event model

Define exact event types and payload shapes.

### G. API contracts

Define gateway endpoints, internal APIs, and service interfaces.

### H. MCP integration

Explain exactly where Cubic intercepts/receives tool calls and what normalized representation it uses.

### I. Ledger integration

Determine the real integration boundary and implementation path based on the actual available SDK/CLI in this environment.

### J. Hedera integration

Determine exactly how the x402-gated service, payment flow, wallet/payment authority, and settlement work.

### K. The Graph integration

Choose the smallest meaningful Graph integration that genuinely affects the runtime or network view.

### L. Contract scope

Only propose Solidity contracts that are genuinely needed.
Do not invent blockchain contracts merely to have Solidity code.

### M. Frontend scope

Only build the UI needed to expose the real underlying system:

* tenant control plane
* request/action trace
* network visualization
* agent detail
* policy/risk decision detail

Do NOT spend the next phase creating more landing-page polish.

### N. Demo sequence

Design a 2–4 minute primary demo that proves the system rather than describing it.

### O. Build order

Break the implementation into small vertical slices where every slice leaves the repository in a runnable state.

Prioritize:

1. core runtime/event model
2. gateway + policy decision
3. capability issuance
4. real service execution
5. Hedera x402
6. Ledger integration
7. Graph/trust context
8. audit/network event propagation
9. frontend integration
10. adversarial/demo flows

## Planning discipline

Before recommending implementation, inspect the existing code deeply.

Use the repository's GitNexus instructions when exploring/impacting symbols.

Do not rewrite existing architecture unnecessarily.

Prefer boring, composable interfaces over speculative abstractions.

Prefer one complete real flow over five incomplete integrations.

The final output must be a detailed implementation plan that another coding agent can execute directly, including:

* files to create/change
* package boundaries
* interfaces
* schemas
* routes
* services
* environment variables
* external dependencies
* test strategy
* local development setup
* demo fixtures
* acceptance criteria
* implementation order

End the plan with a concise section titled:

`## The One Thing We Must Have Working`

This should describe the single end-to-end flow that makes Cubic a real product rather than a visual prototype.
