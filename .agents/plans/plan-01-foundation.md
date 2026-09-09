---
guide: .agents/guides/guide-01-bootstrap.md
status: ready
depends-on: [plan-00-architecture]
---

# Plan 01 — Foundation: Postgres, config, canonical event model

**HOW TO USE:** sections marked **EXACT** are verbatim contracts — copy them as written. If an EXACT block fails, STOP and report; never silently redesign. Steps are ordered; execute in order.

## Objective

Persistence core for every later plan: env config (loaded in EVERY runtime, not just Next), full Postgres schema, canonical append-only event bus, seedable demo tenant, health endpoint, test runner.

## Preconditions

- `plan-00-architecture.md` read (§B.1 domain types, §E table list, §F event payloads).
- `DATABASE_URL` in `app/.env.local` (user-provided). Confirm `.env*` git-ignored.

## Steps

1. **Deps** (`app/package.json`): `drizzle-orm@^0.44`, `postgres@^3.4`, `zod@^3.25`, `dotenv@^16.4`; dev: `drizzle-kit@^0.31`, `vitest@^3.2`, `tsx@^4.19`. If a pinned version fails to install, take the latest stable of the same major and note it in your report.

2. **EXACT — `app/src/server/domain.ts`**: copy plan-00 §B.1 verbatim (all types + `ReasonCode` + this error-code block):

```ts
export const apiErrorCodes = [
  "AGENT_NOT_FOUND", "TASK_NOT_FOUND", "TOOL_NOT_FOUND", "INVALID_REQUEST",
  "CAPABILITY_REJECTED", "PAYMENT_REQUIRED", "INTERNAL",
] as const;
export type ApiErrorCode = (typeof apiErrorCodes)[number];
```

3. **EXACT — `app/src/server/load-env.ts`** (new; fixes the "env missing outside Next" trap):

```ts
// MUST be the first import in every non-Next entrypoint (config.ts, drizzle.config.ts,
// vitest setup, tsx scripts). Next.js loads app/.env.local itself; nothing else does.
import { config as loadEnvFile } from "dotenv";
import { resolve } from "node:path";

loadEnvFile({ path: resolve(process.cwd(), ".env.local") });
```

   Root scripts run via `pnpm --filter app …`, which sets cwd to `app/` — so `resolve(process.cwd(), ".env.local")` finds `app/.env.local` in every case.

4. **EXACT — `app/src/server/config.ts`**: first line `import "./load-env";`, then the zod schema from the previous version of this plan (required `DATABASE_URL`; `LEDGER_PROVIDER`, `HEDERA_NETWORK`, `X402_SCANNER_PRICE_CENTS`, `X402_DEV_BYPASS`, `X402_SIMULATE_FAILURE` with defaults; optional `AGENT0_SUBGRAPH_URL`, `LLM_INTENT_PROVIDER`, `GITHUB_TOKEN`, `LEDGER_WALLET_CLI_PATH`, `HEDERA_OPERATOR_ID`, `HEDERA_OPERATOR_KEY`), fail-fast `config()` singleton cached on `globalThis.__cubicConfig` throwing `Invalid environment: <path>: <message>; …` on failure.

5. **EXACT — `app/src/server/db/schema.ts`**: the full 13-table schema from the previous version of this plan, PLUS this column on `decisions` (review fix — `matched_rule_id` must be queryable for the trace UI):

```ts
matchedRuleId: text("matched_rule_id").notNull(),
```

   placed directly after `matchedPolicy`. Everything else in the schema is unchanged. This is the single permitted post-freeze schema addition; after this plan merges, `schema.ts` is frozen (later plans may not touch it).

6. **EXACT — `app/src/server/db/client.ts`:**

```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "../config";
import * as schema from "./schema";

declare global {
  // eslint-disable-next-line no-var
  var __cubicDb: ReturnType<typeof makeDb> | undefined;
}

function makeDb() {
  const client = postgres(config().DATABASE_URL, { max: 5 });
  return drizzle(client, { schema });
}

export function db() {
  if (!globalThis.__cubicDb) globalThis.__cubicDb = makeDb();
  return globalThis.__cubicDb;
}
```

7. **Migrations**: `app/drizzle.config.ts` — first line `import "./src/server/load-env";`, then `dialect: "postgresql"`, `schema: "./src/server/db/schema.ts"`, `out: "./drizzle"`, `dbCredentials: { url: config().DATABASE_URL }`. Scripts: `db:generate` → `drizzle-kit generate`, `db:migrate` → `drizzle-kit migrate`, `db:studio` → `drizzle-kit studio`.

8. **EXACT — `app/src/server/events/types.ts`**: the 17-entry zod schema map from the previous version of this plan (fields exactly per plan-00 §F), with these two fixes:
   - define `const _eventTypes = [ …17 strings… ] as const; export type EventType = (typeof _eventTypes)[number]; export const eventTypes: [EventType, ...EventType[]] = [..._eventTypes];` then `z.enum(eventTypes)` (a bare `as const` tuple breaks `z.enum`'s `[string, ...string[]]` parameter).
   - `emitInput` / `EventEnvelope` as before (`payload: z.record(z.string(), z.unknown())`).

9. **EXACT — `app/src/server/events/bus.ts`**:

```ts
import { randomUUID as uuid } from "node:crypto";
import { db } from "../db/client";
import { auditEvents } from "../db/schema";
import { emitInput, payloadSchemas, type EmitInput, type EventEnvelope } from "./types";
import type { RiskClass } from "../domain";

// Meta is best-effort context for the plan-08 projection. Audit row is unaffected.
export interface ProjectionMeta {
  agent_key?: string;
  category?: string;
  risk_class?: RiskClass;
}

export async function emit(input: EmitInput, meta: ProjectionMeta = {}): Promise<EventEnvelope> {
  const parsed = emitInput.safeParse(input);
  if (!parsed.success) throw new Error(`invalid event envelope: ${parsed.error.message}`);
  const payloadCheck = payloadSchemas[parsed.data.event_type].safeParse(parsed.data.payload);
  if (!payloadCheck.success) throw new Error(`invalid payload for ${parsed.data.event_type}: ${payloadCheck.error.message}`);
  const envelope: EventEnvelope = {
    ...parsed.data,
    event_id: uuid(),
    occurred_at: new Date().toISOString(),
  };
  await db().insert(auditEvents).values({
    tenantId: envelope.tenant_id,
    taskId: envelope.task_id,
    agentId: envelope.agent_id,
    eventType: envelope.event_type,
    payload: envelope.payload,
  });
  void meta; // plan-08 wires the projection here; today it is accepted and ignored.
  return envelope;
}
```

   Append-only: no update/delete functions in this file, ever.

10. **EXACT — seed** (`app/src/server/demo/seed.ts`, route `POST /api/demo/seed`): fixture JSON identical to the previous version of this plan (demo tenant, `agent:8472`, 6 tools, 3 stub policies, budget-50 task). Three fixes:
    - Resolve the tenant first, literally: `const [tenant] = await db().select().from(tenants).where(eq(tenants.slug, "demo")); if (!tenant) throw new Error("seed: demo tenant missing");` then scope every delete/insert by `tenant.id`.
    - Map fixture snake_case keys to drizzle camelCase props **explicitly field-by-field** (`agent_key` → `agentKey`, `budget_usd_cents` → `budgetUsdCents`, `erc8004_identity` → `erc8004Identity`, `declared_capabilities` → `declaredCapabilities`, `default_risk_class` → `defaultRiskClass`, `executor_config` → `executorConfig`). No generic case converter.
    - `network_events` scoping: compute demo pseudonyms in seed — `sha256(agent_key + "|cubic-network-v1").hexdigest.slice(0, 16)` for each demo agent — and delete only rows with those pseudonyms. Never touch other rows; never TRUNCATE.
    - Idempotent: running twice leaves identical demo-tenant row counts.

11. **`app/src/app/api/health/route.ts`**: `SELECT 1` via the db client → `{ ok: true, data: { db: "up", version: "0.1.0" } }`; on failure `{ ok: false, error: { code: "INTERNAL", message } }` with 503.

12. **Test runner**: `app/vitest.config.ts` (environment `node`, include `src/**/*.test.ts` + `tests/**/*.test.ts`, `setupFiles: ["./src/server/load-env.ts"]`); root `package.json` gains `"test": "pnpm --filter app test"`.

## Acceptance criteria

- [ ] `pnpm --filter app db:generate` produces the initial migration; `db:migrate` applies cleanly — run from a shell WITHOUT `DATABASE_URL` exported (proves `load-env.ts` works; the `.env.local` file is the only source).
- [ ] `pnpm --filter app test` passes: (a) `config()` with missing `DATABASE_URL` throws containing `DATABASE_URL`; (b) for **all 17 event types**, `emit()` with a valid sample payload persists a row and the envelope validates; (c) invalid payload throws AND writes no row; (d) seed twice → identical demo-tenant counts, and a pre-created foreign tenant (`slug: "test-plan-01"`) with rows **survives**; (e) deleting demo `network_events` by pseudonym leaves a foreign-pseudonym row intact.
- [ ] With `pnpm dev` running (no env exported in that shell either): `curl -s localhost:3000/api/health` → `{"ok":true,…}`; `curl -s -X POST localhost:3000/api/demo/seed` → `{"ok":true,…}`.
- [ ] `pnpm typecheck && pnpm lint` green.

## Out of scope

Gateway pipeline (plan-02), capabilities (plan-03), network projection (plan-08 owns `events/projection.ts` — the `meta` param it will consume is already accepted here).
