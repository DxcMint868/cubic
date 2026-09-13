import { eq, inArray } from "drizzle-orm";
import { createHash } from "node:crypto";
import { config } from "../config";
import { logger } from "../logging";
import { db } from "../db/client";
import {
  tenants, agents, tools, policies, tasks, intents, decisions,
  capabilities, approvals, executions, payments, auditEvents, networkEvents,
} from "../db/schema";

const withPseudonym = (agentKey: string) =>
  createHash("sha256").update(`${agentKey}|cubic-network-v1`).digest("hex").slice(0, 16);

const fixture = {
  tenant: { slug: config().DEMO_TENANT_SLUG, name: "Cubic Demo" },
  agents: [{
    agent_key: "agent:8472", name: "deploy-agent", environment: "demo",
    status: "active", erc8004_identity: "84532:9223",
    declared_capabilities: ["github.get_pull_request", "github.read_file", "github.merge_pull_request", "deploy.production", "scanner.scan", "task.complete"],
  }, {
    // plan-14: REAL low-reputation identity — Base Agent0 agent 8453:74108
    // carries live negative feedback (reputation ~0.10) and drives a genuine
    // reputation_below_threshold escalate on camera. The in-code
    // "fixture:low-rep" map remains as the labeled offline fallback (no seed
    // row references it).
    agent_key: "agent:lab-1", name: "low-rep-research-agent", environment: "demo",
    status: "active", erc8004_identity: "8453:74108",
    declared_capabilities: ["github.get_pull_request"],
  }, {
    // Owned Sepolia identities (registered live; feedback 90–95, above the
    // 0.80 floor — same decisions as the old static defaults).
    agent_key: "agent:treasury", name: "treasury-agent", environment: "demo",
    status: "active", erc8004_identity: "84532:9224",
    declared_capabilities: ["treasury.swap", "treasury.transfer", "treasury.stake", "task.complete"],
  }, {
    agent_key: "agent:reader", name: "reader-agent", environment: "demo",
    status: "active", erc8004_identity: "84532:9225",
    declared_capabilities: ["github.get_pull_request", "github.read_file"],
  }],
  tools: [
    { name: "github.get_pull_request", category: "coding", default_risk_class: "low", executor: "github", executor_config: {} },
    { name: "github.read_file", category: "coding", default_risk_class: "low", executor: "github", executor_config: {} },
    { name: "github.merge_pull_request", category: "coding", default_risk_class: "high", executor: "github", executor_config: {} },
    { name: "deploy.production", category: "deploy", default_risk_class: "critical", executor: "github", executor_config: {} },
    { name: "scanner.scan", category: "security", default_risk_class: "medium", executor: "scanner", executor_config: { "endpoint": "http://localhost:3000/api/services/scanner/scan" } },
    { name: "task.complete", category: "control", default_risk_class: "low", executor: "task", executor_config: {} },
  ],
  policies: [
    {
      name: "default-v1", version: 1, rules: [
        { "id": "deny-secret-resources", "type": "resource_class", "match": ["secret"], "decision": "deny", "reason": "secret_resource" },
        { "id": "deny-cross-task", "type": "resource_class", "match": ["cross_task"], "decision": "deny", "reason": "resource_outside_task" },
        { "id": "tool-allowlist", "type": "tool_allowlist",
          "tools": ["github.get_pull_request", "github.read_file", "github.merge_pull_request", "deploy.production", "scanner.scan", "task.complete"],
          "decision": "deny", "reason": "tool_not_allowed" },
        { "id": "reputation-floor", "type": "min_reputation", "min": 0.80, "decision": "escalate", "reason": "reputation_below_threshold" },
        { "id": "risk-approval", "type": "risk_class", "match": ["high", "critical"], "decision": "escalate", "reason": "risk_requires_approval" },
        { "id": "default-allow", "type": "default", "decision": "allow", "reason": "policy_default_allow" }
      ],
    },
    {
      name: "payment-v1", version: 1, rules: [
        { "id": "service-allowlist", "type": "service_allowlist", "services": ["scanner"], "decision": "deny", "reason": "service_not_approved" },
        { "id": "budget", "type": "budget", "decision": "deny", "reason": "budget_exceeded" },
        { "id": "reputation-floor", "type": "min_reputation", "min": 0.80, "decision": "escalate", "reason": "reputation_below_threshold" },
        { "id": "default-allow", "type": "default", "decision": "allow", "reason": "policy_default_allow" }
      ],
    },
    {
      name: "production-merge-v1", version: 1, rules: [
        { "id": "merge-only", "type": "tool_allowlist", "tools": ["github.merge_pull_request"], "decision": "deny", "reason": "tool_not_allowed" },
        { "id": "merge-reputation", "type": "min_reputation", "min": 0.90, "decision": "escalate", "reason": "reputation_below_threshold" },
        { "id": "merge-risk", "type": "risk_class", "match": ["high"], "decision": "escalate", "reason": "risk_requires_approval" },
        { "id": "default-deny", "type": "default", "decision": "deny", "reason": "policy_default_deny" }
      ],
    },
  ],
  tasks: [{
    agent_key: "agent:8472",
    title: "Review and deploy PR #421 in acme/backend; purchase a security scan if permitted (budget $0.50)",
    budget_usd_cents: 50, status: "open",
  }],
} as const;

export async function seed(): Promise<{ agents: number; tools: number; policies: number; tasks: number }> {
  let [tenant] = await db().select().from(tenants).where(eq(tenants.slug, config().DEMO_TENANT_SLUG));
  if (!tenant) {
    await db().insert(tenants).values({ slug: fixture.tenant.slug, name: fixture.tenant.name }).onConflictDoNothing({ target: tenants.slug });
    [tenant] = await db().select().from(tenants).where(eq(tenants.slug, config().DEMO_TENANT_SLUG));
  }
  if (!tenant) throw new Error("seed: demo tenant missing");

  // Demo-agent chain ids (child → parent), collected in JS to scope every delete by tenant.
  const demoAgents = await db().select().from(agents).where(eq(agents.tenantId, tenant.id));
  const agentIds = demoAgents.map((a) => a.id);
  const tenantIntents = agentIds.length
    ? await db().select().from(intents).where(inArray(intents.agentId, agentIds))
    : [];
  const intentIds = tenantIntents.map((i) => i.id);
  const tenantDecisions = intentIds.length
    ? await db().select().from(decisions).where(inArray(decisions.intentId, intentIds))
    : [];
  const decisionIds = tenantDecisions.map((d) => d.id);
  const tenantCapabilities = decisionIds.length
    ? await db().select().from(capabilities).where(inArray(capabilities.decisionId, decisionIds))
    : [];
  const capabilityIds = tenantCapabilities.map((c) => c.id);

  // Demo pseudonyms for network_events; never touch other (foreign) pseudonyms.
  const pseudonyms = fixture.agents.map((a) => withPseudonym(a.agent_key));

  // Delete demo rows only, children first. Never TRUNCATE/never touch other tenants.
  await db().delete(auditEvents).where(eq(auditEvents.tenantId, tenant.id));
  if (capabilityIds.length) {
    await db().delete(executions).where(inArray(executions.capabilityId, capabilityIds));
    await db().delete(payments).where(inArray(payments.capabilityId, capabilityIds));
  }
  if (decisionIds.length) {
    await db().delete(approvals).where(inArray(approvals.decisionId, decisionIds));
    await db().delete(capabilities).where(inArray(capabilities.decisionId, decisionIds));
  }
  if (intentIds.length) await db().delete(decisions).where(inArray(decisions.intentId, intentIds));

  if (agentIds.length) await db().delete(intents).where(inArray(intents.agentId, agentIds));
  await db().delete(tasks).where(eq(tasks.tenantId, tenant.id));
  await db().delete(agents).where(eq(agents.tenantId, tenant.id));
  await db().delete(tools).where(eq(tools.tenantId, tenant.id));
  await db().delete(policies).where(eq(policies.tenantId, tenant.id));
  await db().delete(networkEvents).where(inArray(networkEvents.agentPseudonym, pseudonyms));

  // Upsert fixture — explicit field-by-field mapping, no generic case converter.
  const agentRows = fixture.agents.map((a) => ({
    tenantId: tenant.id,
    agentKey: a.agent_key,
    erc8004Identity: a.erc8004_identity,
    name: a.name,
    environment: a.environment,
    status: a.status,
    declaredCapabilities: [...a.declared_capabilities],
  }));
  await db().insert(agents).values(agentRows);
  await db().insert(tools).values(fixture.tools.map((tool) => ({
    tenantId: tenant.id,
    name: tool.name,
    category: tool.category,
    defaultRiskClass: tool.default_risk_class,
    executor: tool.executor,
    executorConfig: { ...tool.executor_config },
  })));
  await db().insert(policies).values(fixture.policies.map((policy) => ({
    tenantId: tenant.id,
    name: policy.name,
    version: policy.version,
    rules: policy.rules.map((rule) => ({ ...rule })),
  })));

  const insertedAgents = await db().select().from(agents).where(eq(agents.tenantId, tenant.id));
  const agentByKey = new Map(insertedAgents.map((a) => [a.agentKey, a.id]));
  const taskRows = fixture.tasks.map((taskRep) => {
    const agentId = agentByKey.get(taskRep.agent_key);
    if (!agentId) throw new Error(`seed: fixture agent missing ${taskRep.agent_key}`);
    return {
      tenantId: tenant.id,
      agentId,
      title: taskRep.title,
      budgetUsdCents: taskRep.budget_usd_cents,
      status: taskRep.status,
    };
  });
  await db().insert(tasks).values(taskRows);

  const counts = { agents: agentRows.length, tools: fixture.tools.length, policies: fixture.policies.length, tasks: taskRows.length };
  logger("seed").info("demo tenant reseeded", { tenant: fixture.tenant.slug, ...counts });
  return counts;
}
