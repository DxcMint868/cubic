---
guide: .agents/guides/guide-01-bootstrap.md
status: ready
depends-on: [plan-00-architecture]
---

# Plan 01 — Foundation: Postgres, config, canonical event model

**HOW TO USE:** sections marked **EXACT** are verbatim contracts — copy them as written. If an EXACT block fails, STOP and report; never silently redesign. Steps are ordered; execute in order.

## Objective

Persistence core for every later plan: env config, full Postgres schema, canonical append-only event bus, seedable demo tenant, health endpoint, test runner.

## Preconditions

- `plan-00-architecture.md` read (§E table list, §F event payloads, §B.1 shared types — you create `domain.ts` here).
- `DATABASE_URL` in `app/.env.local` (user-provided). Confirm `.env*` git-ignored.

## Steps

1. **Deps** (`app/package.json`): `drizzle-orm@^0.44`, `postgres@^3.4`, `zod@^3.25`; dev: `drizzle-kit@^0.31`, `vitest@^3.2`, `tsx@^4.19`. If a pinned version fails to install, take the latest stable of the same major and note it.

2. **EXACT — `app/src/server/domain.ts`**: copy plan-00 §B.1 verbatim (types + `ReasonCode` + API error codes as a `const apiErrorCodes = [...] as const` array).

3. **EXACT — `app/src/server/config.ts`:**

```ts
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  LEDGER_PROVIDER: z.enum(["dev", "ledger"]).default("dev"),
  HEDERA_NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),
  X402_SCANNER_PRICE_CENTS: z.coerce.number().int().default(25),
  X402_DEV_BYPASS: z.enum(["0", "1"]).default("0"),
  X402_SIMULATE_FAILURE: z.enum(["0", "1"]).default("0"),
  AGENT0_SUBGRAPH_URL: z.string().min(1).optional(),
  LLM_INTENT_PROVIDER: z.string().min(1).optional(),
  GITHUB_TOKEN: z.string().min(1).optional(),
  LEDGER_WALLET_CLI_PATH: z.string().min(1).optional(),
  HEDERA_OPERATOR_ID: z.string().min(1).optional(),
  HEDERA_OPERATOR_KEY: z.string().min(1).optional(),
});

export type Config = z.infer<typeof schema>;

declare global {
  // eslint-disable-next-line no-var
  var __cubicConfig: Config | undefined;
}

export function config(): Config {
  if (!globalThis.__cubicConfig) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(
        `Invalid environment: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      );
    }
    globalThis.__cubicConfig = parsed.data;
  }
  return globalThis.__cubicConfig;
}
```

4. **EXACT — `app/src/server/db/schema.ts`** (all 13 tables; column names/types/checks/indexes exactly this):

```ts
import { sql } from "drizzle-orm";
import {
  pgTable, uuid, text, integer, jsonb, timestamp, bigserial,
  check, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import type { Reason, NormalizedIntent } from "../domain";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "string" });

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("tenants_slug_key").on(t.slug)]);

export const agents = pgTable("agents", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  agentKey: text("agent_key").notNull(),
  erc8004Identity: text("erc8004_identity"),
  name: text("name").notNull(),
  environment: text("environment").notNull().default("demo"),
  status: text("status").notNull().default("active"),
  declaredCapabilities: jsonb("declared_capabilities").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("agents_tenant_key").on(t.tenantId, t.agentKey),
  check("agents_status_check", sql`${t.status} in ('active','suspended')`),
]);

export const tools = pgTable("tools", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  category: text("category").notNull(),
  defaultRiskClass: text("default_risk_class").notNull(),
  executor: text("executor").notNull(),
  executorConfig: jsonb("executor_config").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("tools_tenant_name").on(t.tenantId, t.name),
  check("tools_risk_check", sql`${t.defaultRiskClass} in ('low','medium','high','critical')`),
]);

export const policies = pgTable("policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  version: integer("version").notNull().default(1),
  rules: jsonb("rules").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("policies_tenant_name_version").on(t.tenantId, t.name, t.version)]);

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  agentId: uuid("agent_id").notNull().references(() => agents.id),
  title: text("title").notNull(),
  budgetUsdCents: integer("budget_usd_cents"),
  status: text("status").notNull().default("open"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [check("tasks_status_check", sql`${t.status} in ('open','completed','failed')`)]);

export const intents = pgTable("intents", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id").references(() => tasks.id),
  agentId: uuid("agent_id").notNull().references(() => agents.id),
  tool: text("tool").notNull(),
  resource: text("resource"),
  argumentsRedacted: jsonb("arguments_redacted").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  riskClass: text("risk_class").notNull(),
  origin: text("origin").notNull().default("agent"),
  normalized: jsonb("normalized").$type<NormalizedIntent | null>(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [
  index("intents_task_idx").on(t.taskId, t.createdAt),
  check("intents_risk_check", sql`${t.riskClass} in ('low','medium','high','critical')`),
]);

export const decisions = pgTable("decisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  intentId: uuid("intent_id").notNull().references(() => intents.id),
  decision: text("decision").notNull(),
  matchedPolicy: text("matched_policy").notNull(),
  reasons: jsonb("reasons").$type<Reason[]>().notNull().default(sql`'[]'::jsonb`),
  contextSnapshotHash: text("context_snapshot_hash").notNull(),
  riskScore: integer("risk_score").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [check("decisions_decision_check", sql`${t.decision} in ('allow','deny','escalate')`)]);

export const capabilities = pgTable("capabilities", {
  id: uuid("id").primaryKey().defaultRandom(),
  decisionId: uuid("decision_id").notNull().references(() => decisions.id),
  subject: text("subject").notNull(),
  action: text("action").notNull(),
  resource: text("resource").notNull(),
  constraints: jsonb("constraints").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  budgetUsdCents: integer("budget_usd_cents"),
  expiresAt: ts("expires_at").notNull(),
  nonce: text("nonce").notNull(),
  policyHash: text("policy_hash").notNull(),
  status: text("status").notNull().default("issued"),
  issuedAt: ts("issued_at").notNull().defaultNow(),
  consumedAt: ts("consumed_at"),
}, (t) => [
  uniqueIndex("capabilities_nonce_key").on(t.nonce),
  check("capabilities_status_check", sql`${t.status} in ('issued','consumed','expired','revoked')`),
]);

export const approvals = pgTable("approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  decisionId: uuid("decision_id").notNull().references(() => decisions.id),
  type: text("type").notNull(),
  status: text("status").notNull().default("pending"),
  provider: text("provider").notNull(),
  providerRef: text("provider_ref"),
  requestedAt: ts("requested_at").notNull().defaultNow(),
  completedAt: ts("completed_at"),
}, (t) => [
  check("approvals_type_check", sql`${t.type} in ('ledger','human')`),
  check("approvals_status_check", sql`${t.status} in ('pending','approved','rejected')`),
]);

export const executions = pgTable("executions", {
  id: uuid("id").primaryKey().defaultRandom(),
  capabilityId: uuid("capability_id").notNull().references(() => capabilities.id),
  tool: text("tool").notNull(),
  status: text("status").notNull().default("running"),
  executor: text("executor").notNull(),
  resultSummary: text("result_summary"),
  error: text("error"),
  startedAt: ts("started_at").notNull().defaultNow(),
  completedAt: ts("completed_at"),
}, (t) => [check("executions_status_check", sql`${t.status} in ('running','succeeded','failed')`)]);

export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  capabilityId: uuid("capability_id").notNull().references(() => capabilities.id),
  service: text("service").notNull(),
  network: text("network").notNull(),
  amountUsdCents: integer("amount_usd_cents").notNull(),
  status: text("status").notNull().default("requested"),
  x402Ref: text("x402_ref"),
  createdAt: ts("created_at").notNull().defaultNow(),
  settledAt: ts("settled_at"),
}, (t) => [check("payments_status_check", sql`${t.status} in ('requested','completed','failed')`)]);

export const auditEvents = pgTable("audit_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  tenantId: uuid("tenant_id").references(() => tenants.id),
  taskId: uuid("task_id").references(() => tasks.id),
  agentId: uuid("agent_id").references(() => agents.id),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("audit_events_task_idx").on(t.taskId, t.createdAt)]);

export const networkEvents = pgTable("network_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  eventType: text("event_type").notNull(),
  agentPseudonym: text("agent_pseudonym").notNull(),
  agentCategory: text("agent_category").notNull(),
  actionClass: text("action_class").notNull(),
  outcome: text("outcome").notNull(),
  riskClass: text("risk_class").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("network_events_created_idx").on(t.createdAt)]);
```

5. **`app/src/server/db/client.ts`**: postgres.js `sql` singleton + `drizzle(sql)`, cached on `globalThis.__cubicDb` (same pattern as config).

6. **Migrations**: `app/drizzle.config.ts` → `dialect: "postgresql"`, `schema: "./src/server/db/schema.ts"`, `out: "./drizzle"`, `dbCredentials: { url: config().DATABASE_URL }`. Scripts: `db:generate` → `drizzle-kit generate`, `db:migrate` → `drizzle-kit migrate`, `db:studio` → `drizzle-kit studio`.

7. **EXACT — `app/src/server/events/types.ts`**: one zod object per event type, fields exactly per plan-00 §F table. Skeleton:

```ts
import { z } from "zod";

export const eventTypes = [
  "intent.created", "policy.evaluated", "capability.issued", "capability.denied",
  "capability.escalated", "capability.consumed", "capability.rejected",
  "ledger.approval.requested", "ledger.approval.completed",
  "payment.requested", "payment.completed", "payment.failed", "service.discovered",
  "tool.execution.started", "tool.execution.completed", "tool.execution.failed",
  "task.completed",
] as const;
export type EventType = (typeof eventTypes)[number];

const uuid = z.string().uuid();
const risk = z.enum(["low", "medium", "high", "critical"]);
const dec = z.enum(["allow", "deny", "escalate"]);

export const payloadSchemas: Record<EventType, z.ZodTypeAny> = {
  "intent.created": z.object({ intent_id: uuid, tool: z.string(), resource: z.string().nullable().default(null), risk_class: risk, origin: z.enum(["agent", "payment_discovery"]) }),
  "policy.evaluated": z.object({ intent_id: uuid, decision_id: uuid, decision: dec, matched_policy: z.string(), matched_rule_id: z.string(), reason_codes: z.array(z.string()), risk_score: z.number().int() }),
  "capability.issued": z.object({ capability_id: uuid, decision_id: uuid, subject: z.string(), action: z.string(), resource: z.string(), budget_usd_cents: z.number().int().nullable(), expires_at: z.string(), nonce: z.string().length(64), policy_hash: z.string() }),
  "capability.denied": z.object({ intent_id: uuid, decision_id: uuid, reason_codes: z.array(z.string()) }),
  "capability.escalated": z.object({ intent_id: uuid, decision_id: uuid, approval_id: uuid, reason_codes: z.array(z.string()) }),
  "capability.consumed": z.object({ capability_id: uuid, execution_id: uuid.nullable() }),
  "capability.rejected": z.object({ capability_id: uuid.nullable(), reason: z.enum(["not_found", "replay", "expired", "action_mismatch", "resource_mismatch", "budget_exceeded"]), requested_action: z.string().nullable(), requested_resource: z.string().nullable() }),
  "ledger.approval.requested": z.object({ approval_id: uuid, decision_id: uuid, provider: z.enum(["dev", "ledger"]), action: z.string(), resource: z.string() }),
  "ledger.approval.completed": z.object({ approval_id: uuid, decision_id: uuid, provider: z.enum(["dev", "ledger"]), outcome: z.enum(["approved", "rejected"]) }),
  "payment.requested": z.object({ payment_id: uuid, capability_id: uuid, service: z.string(), network: z.literal("hedera"), amount_usd_cents: z.number().int() }),
  "payment.completed": z.object({ payment_id: uuid, capability_id: uuid, settlement_ref: z.string() }),
  "payment.failed": z.object({ payment_id: uuid, capability_id: uuid, error_code: z.string() }),
  "service.discovered": z.object({ intent_id: uuid, service: z.string(), price_usd_cents: z.number().int(), challenge_ref: z.string() }),
  "tool.execution.started": z.object({ execution_id: uuid, capability_id: uuid, tool: z.string(), resource: z.string() }),
  "tool.execution.completed": z.object({ execution_id: uuid, capability_id: uuid, result_summary: z.string() }),
  "tool.execution.failed": z.object({ execution_id: uuid, capability_id: uuid, error_code: z.string() }),
  "task.completed": z.object({ task_id: uuid, status: z.enum(["completed", "failed"]), summary: z.string().nullable() }),
};

export const emitInput = z.object({
  event_type: z.enum(eventTypes),
  tenant_id: uuid,
  task_id: uuid.nullable().default(null),
  agent_id: uuid.nullable().default(null),
  payload: z.record(z.string(), z.unknown()),
});
export type EmitInput = z.infer<typeof emitInput>;
export type EventEnvelope = EmitInput & { event_id: string; occurred_at: string };
```

8. **`app/src/server/events/bus.ts`**: `emit(input: EmitInput): Promise<EventEnvelope>` — validate `input.payload` against `payloadSchemas[input.event_type]` (throw `Error("invalid payload for " + event_type)` on failure — no row written), insert into `audit_events` with a fresh `uuid()` as payload-independent envelope id (return `{...input, event_id, occurred_at: new Date().toISOString()}`). Append-only: no update/delete functions in this file, ever.

9. **EXACT — seed fixture** (`app/src/server/demo/seed.ts`, route `POST /api/demo/seed`):

```json
{
  "tenant": { "slug": "demo", "name": "Cubic Demo" },
  "agents": [{
    "agent_key": "agent:8472", "name": "deploy-agent", "environment": "demo",
    "status": "active", "erc8004_identity": null,
    "declared_capabilities": ["github.get_pull_request", "github.read_file", "github.merge_pull_request", "deploy.production", "scanner.scan", "task.complete"]
  }],
  "tools": [
    { "name": "github.get_pull_request", "category": "coding", "default_risk_class": "low", "executor": "github", "executor_config": {} },
    { "name": "github.read_file", "category": "coding", "default_risk_class": "low", "executor": "github", "executor_config": {} },
    { "name": "github.merge_pull_request", "category": "coding", "default_risk_class": "high", "executor": "github", "executor_config": {} },
    { "name": "deploy.production", "category": "deploy", "default_risk_class": "critical", "executor": "github", "executor_config": {} },
    { "name": "scanner.scan", "category": "security", "default_risk_class": "medium", "executor": "scanner", "executor_config": { "endpoint": "http://localhost:3000/api/services/scanner/scan" } },
    { "name": "task.complete", "category": "control", "default_risk_class": "low", "executor": "task", "executor_config": {} }
  ],
  "policies": [
    { "name": "default-v1", "version": 1, "rules": [{ "id": "default-allow", "type": "default", "decision": "allow", "reason": "policy_default_allow" }] },
    { "name": "payment-v1", "version": 1, "rules": [{ "id": "default-allow", "type": "default", "decision": "allow", "reason": "policy_default_allow" }] },
    { "name": "production-merge-v1", "version": 1, "rules": [{ "id": "default-allow", "type": "default", "decision": "allow", "reason": "policy_default_allow" }] }
  ],
  "tasks": [{
    "agent_key": "agent:8472",
    "title": "Review and deploy PR #421 in acme/backend; purchase a security scan if permitted (budget $0.50)",
    "budget_usd_cents": 50, "status": "open"
  }]
}
```

**Seed algorithm (EXACT):** delete rows belonging to the demo tenant only — `DELETE FROM audit_events WHERE tenant_id = (demo tenant id)`, same for every other table by that tenant id (children first: audit_events, network_events is global → DELETE FROM network_events WHERE agent_pseudonym derived from demo agents — if that is hard, delete all network_events rows and note it; they are regenerable) — then upsert fixture. **Never** TRUNCATE global tables. Idempotent: running twice leaves identical row counts.

10. **`app/src/app/api/health/route.ts`**: `SELECT 1` via the db client → `{ ok: true, data: { db: "up", version: "0.1.0" } }`; on failure `{ ok: false, error: { code: "INTERNAL", message } }` with 503.

11. **Test runner**: `app/vitest.config.ts` (environment `node`, include `src/**/*.test.ts`, `tests/**/*.test.ts`); root `package.json` gains `"test": "pnpm --filter app test"`.

## Acceptance criteria

- [ ] `pnpm --filter app db:generate` produces the initial migration; `pnpm --filter app db:migrate` applies cleanly.
- [ ] `pnpm --filter app test` passes: (a) `config()` with missing `DATABASE_URL` throws a message containing `DATABASE_URL`; (b) for **all 17 event types**, `emit()` with a valid sample payload persists a row and the returned envelope validates against `emitInput`; (c) `emit()` with an invalid payload throws AND writes no row; (d) seed run twice → identical demo-tenant row counts, and a pre-created foreign tenant (`slug: "test-plan-01"`) with rows **survives** seeding.
- [ ] `curl -s localhost:3000/api/health` → `{"ok":true,...}`; `curl -s -X POST localhost:3000/api/demo/seed` → `{"ok":true,...}` with `pnpm dev` running.
- [ ] `pnpm typecheck && pnpm lint` green.

## Out of scope

Gateway pipeline (plan-02), capabilities (plan-03), network projection (plan-08 owns `events/projection.ts`).
