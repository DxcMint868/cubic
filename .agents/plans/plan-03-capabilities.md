---
guide: .agents/guides/guide-01-bootstrap.md
status: ready
depends-on: [plan-02-gateway-policy]
---

# Plan 03 — Capability model: issuance, verification, single-use consume

## Objective

The scoped-authorization artifact: agents receive narrowly bounded, expiring, replay-protected capabilities — never credentials.

## Preconditions

plan-02 merged; plan-00 §E capabilities table read.

## Tasks

1. **`capability/issue.ts`**: `issueCapability(decision)` → row `{subject=agent_key, action, resource, constraints (from policy, e.g. branch), budget_usd_cents (payment cases), expires_at = now + TTL (default 5m, per-risk override from policy), nonce = 32-byte crypto random hex, policy_hash = sha256(canonical(matched policy rules + version))}`; status `issued`; emit `capability.issued`. Callable only from an ALLOW decision or an **approved** ESCALATE (approval state is checked).
2. **`capability/verify.ts`**: `consumeCapability(capabilityId, {action, resource, amount?})` — atomic `UPDATE capabilities SET status='consumed', consumed_at=now WHERE id=? AND status='issued' AND expires_at > now RETURNING *`; on success validate action/resource match (and amount ≤ budget), then emit `capability.consumed`. Failure paths emit `capability.rejected` with reason ∈ {not_found, replay, expired, action_mismatch, resource_mismatch, budget_exceeded} and return a rejected result — never throw raw.
3. **Orchestrator wiring**: the ALLOW path now issues a capability and returns it in the tool-call response. The response contains the capability object only — assert that no executor credentials ever serialize into responses.
4. **`POST /api/gateway/verify-capability`**: `{capability_id, action, resource}` → verification report for executors/tests; does **not** consume.
5. **Expiry**: lazy on-read — `verify` treats past `expires_at` as expired regardless of stored status; no background cron for the MVP.
6. **Tests**: happy path issue→verify→consume; replay rejected; expired rejected (clock fixture); wrong action/resource rejected; budget-carrying capability rejects an over-budget consume; revoked capability rejected (the revoke path is used by plan-05 payment failure).

## Acceptance criteria

- [ ] An ALLOW tool-call response contains the capability object and no secrets or credentials (automated assertion on the serialized response).
- [ ] Replaying a consumed capability → `capability.rejected` reason=replay; no execution.
- [ ] Expired capability → reason=expired.
- [ ] Consume is exactly-once under concurrency: two parallel consumes → exactly one succeeds (vitest promise race).
- [ ] `pnpm typecheck` / `lint` / `test` green.

## Out of scope

Cryptographic signing / transferable capabilities (server-side authority is the MVP model; record as future work), execution (plan-04).
