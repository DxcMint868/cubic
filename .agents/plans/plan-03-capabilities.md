---
guide: .agents/guides/guide-01-bootstrap.md
status: ready
depends-on: [plan-02-gateway-policy]
---

# Plan 03 — Capability model: issuance, verification, single-use consume

**HOW TO USE:** **EXACT** blocks are verbatim contracts — copy them. If one fails, STOP and report. Steps are ordered.

## Objective

Agents receive narrowly bounded, expiring, replay-protected capabilities — never credentials.

## Preconditions

plan-02 merged; plan-00 §B.1 (`IssuedCapability`) and §F (`capability.*` payloads) read.

## Steps

1. **EXACT — `capability/issue.ts`**, `issueCapability(decision, intent): Promise<IssuedCapability>`:

```text
fields:
  subject   = intent's agent_key
  action    = intent.normalized.action
  resource  = intent.normalized.resource
  constraints = {}                          // MVP: no extra constraints
  budget_usd_cents = intent.normalized.amount_usd_cents ?? null
  expires_at = now + 5 minutes              // fixed TTL for every risk class in the MVP
  nonce     = crypto.randomBytes(32).toString("hex")       // 64 hex chars
  policy_hash = sha256(canonicalPolicyJson(matched policy {name, version, rules}))
```

   `canonicalPolicyJson` helper (EXACT — recursive key sort, no spaces):

```ts
function canonicalize(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(canonicalize).join(",") + "]";
  if (v && typeof v === "object") {
    return "{" + Object.keys(v as Record<string, unknown>).sort()
      .map((k) => JSON.stringify(k) + ":" + canonicalize((v as Record<string, unknown>)[k])).join(",") + "}";
  }
  return JSON.stringify(v);
}
export const canonicalPolicyJson = (p: { name: string; version: number; rules: unknown[] }) =>
  canonicalize({ name: p.name, version: p.version, rules: p.rules });
```

   Insert row (`status: "issued"`), emit `capability.issued` (payload per plan-00 §F). Callable ONLY from (a) an `allow` decision, or (b) an `escalate` decision whose approval row is `status = 'approved'` — otherwise throw (this is the plan-06 approval gate).

2. **EXACT — `capability/verify.ts`**, `consumeCapability(capabilityId, req: {action, resource, amount?}): Promise<Consumed | Rejected>`, checks in exactly this order:

```text
1. SELECT row by id            → no row: reject "not_found"
2. row.expires_at <= now       → reject "expired"  (also UPDATE status='expired' if still 'issued')
3. row.status != "issued"      → reject "replay"
4. req.action != row.action    → reject "action_mismatch"
5. req.resource != row.resource→ reject "resource_mismatch"
6. req.amount != null
   && (row.budget_usd_cents == null || req.amount > row.budget_usd_cents)
                                → reject "budget_exceeded"
7. atomic: UPDATE capabilities SET status='consumed', consumed_at=now
   WHERE id = ? AND status='issued'   → 0 rows affected: reject "replay"
   else: emit capability.consumed {capability_id, execution_id: null} and return consumed
```

   Every rejection emits `capability.rejected` with `reason`, `requested_action`, `requested_resource` (per plan-00 §F) and returns `{status:"rejected", reason}` — never throws raw.

3. **`POST /api/gateway/verify-capability`** `{capability_id, action, resource}` → report from steps 1–6 WITHOUT the atomic update (non-consuming); `{ok:true, data:{status:"issued"|"would_consume"|"rejected", reason?}}`.

4. **Orchestrator wiring (surgical):** on `allow` → `issueCapability` → put `IssuedCapability` into the response `data.capability`. A `verifyCapability` call (non-consuming) is exposed to plan-04's execution phase; consumption stays plan-04's pre-execution step.

## Acceptance criteria

- [ ] Vitest: issue from allow → `data.capability` matches `IssuedCapability` (nonce is 64 hex chars, `expires_at` ≈ now+5m, `policy_hash` = sha256 hex); serialized response contains no env/secret values (assert the string "DATABASE_URL" and "HEDERA" do not appear).
- [ ] Consume happy path → `capability.consumed` emitted; second consume of same id → reject `replay`; two PARALLEL consumes → exactly one succeeds.
- [ ] Clock-fixture expired row → reject `expired`; random uuid → reject `not_found`; wrong action → `action_mismatch`; wrong resource → `resource_mismatch`; amount 25 with budget 10 → `budget_exceeded`; amount 25 with budget 10 but `budget_usd_cents = null` on the row → `budget_exceeded` (null budget rejects any amount > 0… see step 2 rule 6 — null budget + req.amount → reject).
- [ ] `issueCapability` from an `escalate` decision with a pending approval → throws (gate works).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` green.

## Out of scope

Cryptographic signing / transferable capabilities (server-side authority is the MVP model — note as future work in your report, don't build it), execution (plan-04).
