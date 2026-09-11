import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { agents, capabilities, decisions, intents, payments, tasks } from "../../db/schema";
import type { Facts, RiskClass } from "../../domain";

export interface FactsIntentRef {
  taskId: string;
  tool: string;
}

export interface FactsCtx {
  agentId: string;
  toolRow: { defaultRiskClass: RiskClass } | null;
}

export interface ContextProvider {
  getFacts(intent: FactsIntentRef, ctx: FactsCtx): Promise<Facts>;
}

// Shared facts builder: plan-02's bodies verbatim, with only the reputation
// source parameterized (plan-07 replaces just that source; Facts shape unchanged).
export async function baseFacts(
  intent: FactsIntentRef,
  ctx: FactsCtx,
  agent_reputation: number,
): Promise<Facts> {
  const [agent] = await db().select().from(agents).where(eq(agents.id, ctx.agentId));
  if (!agent) throw new Error(`context: agent row missing ${ctx.agentId}`);
  const [task] = await db().select().from(tasks).where(eq(tasks.id, intent.taskId));
  if (!task) throw new Error(`context: task row missing ${intent.taskId}`);

  // plan-02 EXACT spent query: completed payments joined capability → decision → intent → task.
  const spent = await db()
    .select({ s: sql<number>`coalesce(sum(${payments.amountUsdCents}),0)` })
    .from(payments)
    .innerJoin(capabilities, eq(payments.capabilityId, capabilities.id))
    .innerJoin(decisions, eq(capabilities.decisionId, decisions.id))
    .innerJoin(intents, eq(decisions.intentId, intents.id))
    .where(and(eq(intents.taskId, intent.taskId), eq(payments.status, "completed")));

  return {
    agent_status: agent.status as Facts["agent_status"],
    agent_reputation,
    tool_default_risk: (ctx.toolRow?.defaultRiskClass ?? "medium") as RiskClass,
    task_budget_usd_cents: task.budgetUsdCents,
    budget_spent_usd_cents: Number(spent[0]?.s ?? 0),
  };
}
