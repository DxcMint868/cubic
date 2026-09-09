---
guide: .agents/guides/guide-01-bootstrap.md
status: ready
depends-on: [plan-00-architecture]
---

# Plan 01 — Foundation: Postgres, config, canonical event model

## Objective

Stand up the persistent core every later slice builds on: env/config layer, Postgres schema + migrations (user-supplied `DATABASE_URL`), the canonical append-only event bus, a seedable demo tenant, a health endpoint, and the test runner.

## Preconditions

- `plan-00-architecture.md` read (§E data model, §F event model, env vars in §B/§I/§J/§K).
- `DATABASE_URL` provided by the user → written to `app/.env.local`. Confirm `.env*` is git-ignored; fix `.gitignore` if not.

## Tasks

1. **Dependencies** (`app/package.json`): add `drizzle-orm`, `postgres`, `zod`; dev: `drizzle-kit`, `vitest`, `tsx`.
2. **`app/src/server/config.ts`**: zod-parsed env singleton. Required: `DATABASE_URL`. Optional with defaults: `LEDGER_PROVIDER=dev`, `HEDERA_NETWORK=testnet`, `X402_SCANNER_PRICE_CENTS=25`, `AGENT0_SUBGRAPH_URL`, `LLM_INTENT_PROVIDER` (unset = off), `GITHUB_TOKEN`, `LEDGER_WALLET_CLI_PATH`, `HEDERA_OPERATOR_ID`, `HEDERA_OPERATOR_KEY`. Fail fast with a clear message at startup on missing required vars.
3. **`app/src/server/db/schema.ts`**: full drizzle schema exactly per plan-00 §E — all 13 tables, check constraints, unique constraints, and the three indexes.
4. **`app/src/server/db/client.ts`**: postgres.js pool + drizzle instance, cached on `globalThis` so Next.js dev HMR doesn't open pools per reload.
5. **Migrations**: `app/drizzle.config.ts` (out dir `app/drizzle/`); app scripts `db:generate`, `db:migrate`, `db:studio`.
6. **`app/src/server/events/types.ts`**: the event type union per plan-00 §F plus a zod payload schema per type and the envelope type.
7. **`app/src/server/events/bus.ts`**: `emit(event)` → insert into `audit_events`, return the persisted envelope. Append-only by convention — no update/delete APIs exist anywhere.
8. **Seed**: `app/src/server/demo/seed.ts` + `POST /api/demo/seed` — demo tenant `slug=demo`; agent `agent:8472` (deploy-agent, `environment=demo`); tools `scanner.scan` (medium), `github.get_pull_request` (low), `github.read_file` (low), `github.merge_pull_request` (high), `deploy.production` (critical); policies `default-v1`, `payment-v1`, `production-merge-v1` (rule documents shaped for plan-02 — minimal stub rules acceptable here, plan-02 finalizes the shape). **Safety: seeding deletes only rows belonging to the demo tenant — never global truncates** (the DB is a shared online Postgres).
9. **`app/src/app/api/health/route.ts`**: `{ok, db: "up"|"down", version}`.
10. **Test runner**: `app/vitest.config.ts` (node environment, tsconfig paths); root `package.json` gains `"test": "pnpm --filter app test"`. First tests: config parse (valid/invalid env), event bus round-trip (integration — requires `DATABASE_URL`), migration smoke.

## Acceptance criteria

- [ ] `pnpm db:generate` produces the initial migration; `pnpm db:migrate` applies cleanly to the user's `DATABASE_URL`.
- [ ] `POST /api/demo/seed` is idempotent and touches only demo-tenant rows.
- [ ] `GET /api/health` returns `db:"up"`.
- [ ] Emitting each canonical event type through the bus persists a row; a vitest case asserts the envelope shape for every type in the union.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` all green from repo root.

## Out of scope

Gateway pipeline, policy evaluation, capabilities, network projection (plan-08 owns `projection.ts`).
