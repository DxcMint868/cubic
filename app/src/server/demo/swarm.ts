import "../load-env";
import { and, desc, eq } from "drizzle-orm";
import { config } from "../config";
import { db } from "../db/client";
import { agents, tasks, tenants } from "../db/schema";
import { runToolCall } from "../gateway/orchestrator";

// plan-08 EXACT — 8 synthetic agents (agent:swarm-1 … agent:swarm-8) spread
// over the REACHABLE clusters coding, deploy, security, control (2 agents
// each — the seeded tool categories, so clusters actually occur). Every call
// goes through the real ingest → policy → projection pipeline; no synthetic
// event injection. Run with: pnpm --filter app swarm

export const SWARM_SIZE = 8;

export const SWARM_CAPABILITIES = ["github.get_pull_request", "github.read_file", "scanner.scan", "github.merge_pull_request", "deploy.production", "task.complete"];

interface SwarmCall {
  tool: string;
  arguments: Record<string, unknown>;
}

const prRead: SwarmCall = {
  tool: "github.get_pull_request",
  arguments: { repo: "acme/backend", pr: 421 },
};
const fileRead: SwarmCall = {
  tool: "github.read_file",
  arguments: { repo: "acme/backend", path: "README.md" },
};
const envAttempt: SwarmCall = {
  tool: "github.read_file",
  arguments: { repo: "acme/backend", path: ".env.production" },
};

// Per-agent scripted set: allowed reads shaped by the agent's cluster plus
// one .env read attempt each (deterministic DENY via deny-secret-resources).
function scriptFor(swarmIndex: number): SwarmCall[] {
  switch (swarmIndex % 4) {
    case 0: // coding
      return [prRead, fileRead, envAttempt];
    case 1: // deploy
      return [{ tool: "deploy.production", arguments: { repo: "acme/backend" } }, prRead, envAttempt];
    case 2: // security
      return [{ tool: "scanner.scan", arguments: { target: "acme/backend#421" } }, fileRead, envAttempt];
    default: // control
      return [{ tool: "task.complete", arguments: {} }, fileRead, envAttempt];
  }
}

export interface SwarmAgent {
  key: string;
  agentId: string;
  taskId: string;
  step: number;
}

function swarmIndexOf(key: string): number {
  const n = Number.parseInt(key.split("-").pop() ?? "1", 10);
  return (Number.isFinite(n) ? n : 1) - 1;
}

// Idempotent: existing agent rows and open tasks are reused, never duplicated.
export async function setupSwarm(
  slug: string = process.env.SWARM_TENANT_SLUG ?? config().DEMO_TENANT_SLUG,
): Promise<SwarmAgent[]> {
  let [tenant] = await db().select().from(tenants).where(eq(tenants.slug, slug));
  if (!tenant) {
    [tenant] = await db().insert(tenants).values({ slug, name: "Cubic Swarm" }).returning();
  }
  if (!tenant) throw new Error("swarm: tenant missing");

  const state: SwarmAgent[] = [];
  for (let i = 1; i <= SWARM_SIZE; i += 1) {
    const key = `agent:swarm-${i}`;
    let [agent] = await db()
      .select()
      .from(agents)
      .where(and(eq(agents.tenantId, tenant.id), eq(agents.agentKey, key)));
    if (!agent) {
      [agent] = await db()
        .insert(agents)
        .values({
          tenantId: tenant.id,
          agentKey: key,
          name: `swarm-${i}`,
          environment: "demo",
          status: "active",
          declaredCapabilities: [...SWARM_CAPABILITIES],
        })
        .returning();
    }
    if (!agent) throw new Error(`swarm: agent row missing ${key}`);

    let [task] = await db()
      .select()
      .from(tasks)
      .where(and(eq(tasks.agentId, agent.id), eq(tasks.status, "open")))
      .orderBy(desc(tasks.createdAt))
      .limit(1);
    if (!task) {
      [task] = await db()
        .insert(tasks)
        .values({
          tenantId: tenant.id,
          agentId: agent.id,
          title: `swarm task for ${key}`,
          budgetUsdCents: 50,
          status: "open",
        })
        .returning();
    }
    if (!task) throw new Error(`swarm: task row missing for ${key}`);

    state.push({ key, agentId: agent.id, taskId: task.id, step: 0 });
  }
  return state;
}

// One scripted call for a single agent (round-robin through its script).
export async function swarmStep(agent: SwarmAgent): Promise<string> {
  const script = scriptFor(swarmIndexOf(agent.key));
  const call = script[agent.step % script.length];
  agent.step += 1;
  const result = await runToolCall({
    task_id: agent.taskId,
    agent_key: agent.key,
    tool: call.tool,
    arguments: call.arguments,
  });
  const outcome = result.ok
    ? `${result.data.decision} / ${result.data.matched_rule_id}`
    : `error ${result.error.code}`;
  return `[swarm] ${agent.key} ${call.tool} → ${outcome}`;
}

// One round: every swarm agent makes its next scripted call.
export async function swarmTick(state: SwarmAgent[]): Promise<string[]> {
  const lines: string[] = [];
  for (const agent of state) {
    lines.push(await swarmStep(agent));
  }
  return lines;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const state = await setupSwarm();
  console.log(`[swarm] ${state.length} agents live on tenant slug "${process.env.SWARM_TENANT_SLUG ?? config().DEMO_TENANT_SLUG}"; Ctrl+C to stop.`);
  for (;;) {
    for (const agent of state) {
      try {
        console.log(await swarmStep(agent));
      } catch (err) {
        console.log(`[swarm] ${agent.key} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      await sleep(1000 + Math.random() * 4000);
    }
  }
}

const invokedAsScript = (process.argv[1] ?? "").endsWith("swarm.ts");
if (invokedAsScript) {
  main().catch((err) => {
    console.error(`[swarm] fatal: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
