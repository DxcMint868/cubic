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
  matchedRuleId: text("matched_rule_id").notNull(),
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
