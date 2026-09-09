---
guide: .agents/guides/guide-01-bootstrap.md
status: ready
depends-on: [plan-02-gateway-policy]
---

# Plan 03 — Capability model: issuance, verification, single-use consume

**HOW TO USE:** **EXACT** blocks are verbatim contracts — copy them as written. If an EXACT block fails, STOP and report; never silently redesign. Steps are ordered.

## Objective

Agents receive narrowly bounded, expiring, replay-protected capabilities — never credentials.

## Preconditions

plan-02 merged; plan-00 §B.1 (`IssuedCapability`) and §F (`capability.*` payloads) read.

## Steps

1. **EXACT — `capability/issue.ts`** (the orchestrator passes the policy document through — the `DecisionResult` alone cannot compute `policy_hash`):

```ts
import { randomUUID as uuid } from "node:crypto";
import { createHash } from "node:crypto";

export interface IssueInput {
  decision: DecisionResult;          // from evaluate()
  decisionId: string;                // the persisted decisions row id
  intent: { tool: string; action: string; resource: string; amount_usd_cents?: number; agent_key: string };
  policy: { name: string; version: number; rules: unknown[] };   // the selected rule document
}

export async function issueCapability(input: IssueInput): Promise<IssuedCapability> {
  const { decision, decisionId, intent, policy } = input;
  if (decision.decision === "allow") { /* proceed */ }
  else if (decision.decision === "escalate") {
    const [approval] = await db().select().from(approvals)
      .where(eq(approvals.decisionId, decisionId))
      .orderBy(desc(approvals.requestedAt)).limit(1);
    if (!approval || approval.status !== "approved") {
      throw new Error("capability gate: escalate decision without an approved approval");
    }
  } else {
    throw new Error("capability gate: cannot issue from a deny decision");
  }
  const row = {
    decisionId,
    subject: intent.agent_key,
    action: intent.action,
    resource: intent.resource,
    constraints: {},
    budgetUsdCents: intent.amount_usd_cents ?? null,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),   // fixed 5m TTL, every risk class
    nonce: randomBytes(32).toString("hex"),                          // 64 hex chars
    policyHash: createHash("sha256").update(canonicalPolicyJson(policy)).digest("hex"),
    status: "issued" as const,
  };
  /* insert row, emit capability.issued (payload per plan-00 §F), return IssuedCapability */
}
```

   `canonicalPolicyJson` (EXACT recursive key sort, no spaces) and `canonicalize` — keep the helper from the previous version of this plan unchanged; additionally reuse `canonicalize` for plan-02's facts hash.

2. **EXACT — `capability/verify.ts`** types + ordered checks:

```ts
export type ConsumeResult =
  | { status: "consumed"; capability_id: string }
  | { status: "rejected"; reason: "not_found" | "replay" | "expired" | "action_mismatch" | "resource_mismatch" | "budget_exceeded" };

export async function consumeCapability(
  capabilityId: string,
  req: { action: string; resource: string; amount?: number },
): Promise<ConsumeResult>
```

   Checks in exactly this order (each rejection emits `capability.rejected` with that `reason` + `requested_action`/`requested_resource`, and returns — never throws raw):
   1. SELECT row by id → no row: `not_found`
   2. `new Date(row.expiresAt) <= new Date()` → `expired` (also `UPDATE status='expired'` if still `issued`)
   3. `row.status !== "issued"` → `replay`
   4. `req.action !== row.action` → `action_mismatch`
   5. `req.resource !== row.resource` → `resource_mismatch`
   6. `req.amount != null && (row.budgetUsdCents == null || req.amount > row.budgetUsdCents)` → `budget_exceeded`. Note: when `req.amount` is `undefined` (non-purchase executions), this rule is skipped entirely — a `null` budget rejects only a numeric amount.
   7. atomic `UPDATE capabilities SET status='consumed', consumed_at=now WHERE id=? AND status='issued'` → 0 rows: `replay`; else emit `capability.consumed {capability_id, execution_id: null}` and return consumed.

3. **EXACT — `revokeCapability(capabilityId: string)`** (used by plan-05 payment failure): `UPDATE capabilities SET status='revoked' WHERE id=? AND status='issued'`. No event.

4. **`POST /api/gateway/verify-capability`** `{capability_id, action, resource}` → runs checks 1–6 WITHOUT the atomic update (non-consuming); `{ok:true, data:{status:"issued", reason?: undefined} | {status:"rejected", reason}}`.

5. **Orchestrator wiring (surgical):** on `allow` → `issueCapability({decision, decisionId, intent: {tool, action, resource, amount_usd_cents, agent_key}, policy: <selected rule document>})` → put `IssuedCapability` into `data.capability`. The response contains the capability object only — no credentials ever serialize.

## Acceptance criteria

- [ ] Vitest: issue from allow → `data.capability` matches `IssuedCapability` (nonce 64 hex, `expires_at` ≈ now+5m, `policy_hash` = sha256 hex of the canonical policy JSON — assert it CHANGES when a rule changes, proving it hashes the document, not the name); serialized response contains no env/secret values.
- [ ] Issue from escalate with a pending approval → throws; with an approved approval row → issues.
- [ ] Consume happy path → `capability.consumed`; second consume → `replay`; two PARALLEL consumes → exactly one succeeds.
- [ ] Expired row (clock fixture) → `expired`; random uuid → `not_found`; wrong action/resource → `action_mismatch`/`resource_mismatch`; numeric amount 25 against budget 10 → `budget_exceeded`; `amount: undefined` against `null` budget → proceeds (rule skipped).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` green.

## Out of scope

Cryptographic signing / transferable capabilities (server-side authority is the MVP model — note as future work, don't build it), execution (plan-04).
