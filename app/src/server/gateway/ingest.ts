import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { config } from "../config";
import { db } from "../db/client";
import { agents, intents, tasks, tenants, tools } from "../db/schema";
import { emit } from "../events/bus";
import { SECRET_KEY_RE } from "../logging";
import type { ApiErrorCode, RiskClass, ToolCall } from "../domain";

export class GatewayError extends Error {
  constructor(readonly code: ApiErrorCode, message: string) {
    super(message);
  }
}

const toolCallSchema = z.object({
  task_id: z.string().uuid().optional(),
  agent_key: z.string().min(1),
  tool: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()),
});

// plan-02 EXACT, plan-13 hardening: recursively walk `arguments` with NO depth
// cutoff (the plan-02 depth>3 cutoff could silently persist nested secrets at
// depth 4+; arguments arrive JSON-parsed so full recursion terminates) —
// cycle-guarded for non-JSON object graphs. Secret-ish keys → "[REDACTED]".
function redact(value: unknown, seen = new Set<object>()): unknown {
  if (Array.isArray(value)) return value.map((v) => redact(v, seen));
  if (value !== null && typeof value === "object") {
    if (seen.has(value)) return "[CYCLIC]";
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY_RE.test(key) ? "[REDACTED]" : redact(val, seen);
    }
    return out;
  }
  return value;
}

export interface IngestResult {
  tenantId: string;
  agent: typeof agents.$inferSelect;
  task: typeof tasks.$inferSelect;
  toolRow: typeof tools.$inferSelect | null;
  intent: typeof intents.$inferSelect;
}

export async function ingest(
  input: ToolCall & { origin?: "agent" | "payment_discovery" },
): Promise<IngestResult> {
  const parsed = toolCallSchema.safeParse(input);
  if (!parsed.success) {
    throw new GatewayError(
      "INVALID_REQUEST",
      `invalid ToolCall: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }
  const { task_id, agent_key, tool } = parsed.data;
  const origin = input.origin ?? "agent";

  const [tenant] = await db().select().from(tenants).where(eq(tenants.slug, config().DEMO_TENANT_SLUG));
  if (!tenant) throw new GatewayError("INTERNAL", "demo tenant missing");

  const [agent] = await db()
    .select()
    .from(agents)
    .where(and(eq(agents.tenantId, tenant.id), eq(agents.agentKey, agent_key)));
  if (!agent) throw new GatewayError("AGENT_NOT_FOUND", `agent not found: ${agent_key}`);

  // Unknown tool: do NOT 404 — it falls through to the normalize fallback and dies on tool-allowlist.
  const [toolRow] = await db()
    .select()
    .from(tools)
    .where(and(eq(tools.tenantId, tenant.id), eq(tools.name, tool)));

  let task: typeof tasks.$inferSelect;
  if (task_id) {
    const [found] = await db()
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, task_id), eq(tasks.tenantId, tenant.id)));
    if (!found) throw new GatewayError("TASK_NOT_FOUND", `task not found: ${task_id}`);
    task = found;
  } else {
    const [found] = await db()
      .select()
      .from(tasks)
      .where(and(eq(tasks.agentId, agent.id), eq(tasks.status, "open")))
      .orderBy(desc(tasks.createdAt))
      .limit(1);
    if (!found) throw new GatewayError("TASK_NOT_FOUND", `no open task for agent: ${agent_key}`);
    task = found;
  }

  const riskClass = (toolRow?.defaultRiskClass ?? "medium") as RiskClass;
  const [intent] = await db()
    .insert(intents)
    .values({
      taskId: task.id,
      agentId: agent.id,
      tool,
      resource: null,
      argumentsRedacted: redact(parsed.data.arguments) as Record<string, unknown>,
      riskClass,
      origin,
    })
    .returning();

  await emit(
    {
      event_type: "intent.created",
      tenant_id: tenant.id,
      task_id: task.id,
      agent_id: agent.id,
      payload: { intent_id: intent.id, tool, resource: null, risk_class: riskClass, origin },
    },
    { agent_key: agent.agentKey, category: toolRow?.category, risk_class: riskClass },
  );

  return { tenantId: tenant.id, agent, task, toolRow: toolRow ?? null, intent };
}
