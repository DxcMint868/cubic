import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { agents, approvals, decisions, intents, tasks, tools } from "@/server/db/schema";
import { emit } from "@/server/events/bus";
import { config } from "@/server/config";
import type { ApiErrorCode, DecisionResult, NormalizedIntent, Reason, RiskClass } from "@/server/domain";
import { GatewayError } from "@/server/gateway/ingest";
import { loadPolicyDocument, runExecutionPhase } from "@/server/gateway/orchestrator";

export const dynamic = "force-dynamic";

const HTTP_STATUS: Record<ApiErrorCode, number> = {
  INVALID_REQUEST: 400,
  AGENT_NOT_FOUND: 404,
  TASK_NOT_FOUND: 404,
  TOOL_NOT_FOUND: 404,
  CAPABILITY_REJECTED: 403,
  PAYMENT_REQUIRED: 402,
  INTERNAL: 500,
};

const bodySchema = z.object({ outcome: z.enum(["approved", "rejected"]) });

// plan-06 EXACT: resolve a pending approval; on approval, continue the plan-04
// execution phase and respond with the full tool-call shape.
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    if (!z.string().uuid().safeParse(id).success) {
      return Response.json(
        { ok: false, error: { code: "INVALID_REQUEST", message: "approval id must be a uuid" } },
        { status: 400 },
      );
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { ok: false, error: { code: "INVALID_REQUEST", message: "invalid JSON body" } },
        { status: 400 },
      );
    }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: { code: "INVALID_REQUEST", message: "body must be {outcome: \"approved\" | \"rejected\"}" } },
        { status: 400 },
      );
    }
    const outcome = parsed.data.outcome;

    const [approval] = await db().select().from(approvals).where(eq(approvals.id, id));
    if (!approval) {
      return Response.json(
        { ok: false, error: { code: "INVALID_REQUEST", message: `approval not found: ${id}` } },
        { status: 404 },
      );
    }

    // Claim the row atomically: only a still-pending approval resolves; a
    // second resolve finds zero updated rows.
    const claimed = await db()
      .update(approvals)
      .set({ status: outcome, completedAt: new Date().toISOString() })
      .where(and(eq(approvals.id, id), eq(approvals.status, "pending")))
      .returning();
    if (claimed.length === 0) {
      return Response.json(
        { ok: false, error: { code: "INVALID_REQUEST", message: `approval already resolved: ${id}` } },
        { status: 409 },
      );
    }

    const [decisionRow] = await db().select().from(decisions).where(eq(decisions.id, approval.decisionId));
    if (!decisionRow) throw new Error(`approval ${id}: decision row missing ${approval.decisionId}`);
    const [intentRow] = await db().select().from(intents).where(eq(intents.id, decisionRow.intentId));
    if (!intentRow) throw new Error(`approval ${id}: intent row missing ${decisionRow.intentId}`);
    if (!intentRow.taskId) throw new Error(`approval ${id}: intent ${intentRow.id} has no task`);
    const [taskRow] = await db().select().from(tasks).where(eq(tasks.id, intentRow.taskId));
    if (!taskRow) throw new Error(`approval ${id}: task row missing ${intentRow.taskId}`);
    const [agentRow] = await db().select().from(agents).where(eq(agents.id, intentRow.agentId));
    if (!agentRow) throw new Error(`approval ${id}: agent row missing ${intentRow.agentId}`);

    const meta = { agent_key: agentRow.agentKey, risk_class: intentRow.riskClass as RiskClass };
    await emit(
      {
        event_type: "ledger.approval.completed",
        tenant_id: taskRow.tenantId,
        task_id: intentRow.taskId,
        agent_id: intentRow.agentId,
        payload: {
          approval_id: approval.id,
          decision_id: decisionRow.id,
          provider: config().LEDGER_PROVIDER,
          outcome,
        },
      },
      meta,
    );

    if (outcome === "rejected") {
      return Response.json({
        ok: true,
        data: {
          decision: "escalate",
          approval_id: approval.id,
          approval_outcome: "rejected",
          capability: null,
          payment: null,
          execution: null,
          payment_required: null,
        },
      });
    }

    // approved — rebuild the IssueInput from the persisted rows and continue
    // into the plan-04 execution phase.
    const normalized = intentRow.normalized as NormalizedIntent | null;
    if (!normalized) {
      throw new Error(`approval ${id}: intent ${intentRow.id} has no normalized intent`);
    }
    const decision: DecisionResult = {
      decision: decisionRow.decision as DecisionResult["decision"],
      matched_policy: decisionRow.matchedPolicy,
      matched_rule_id: decisionRow.matchedRuleId,
      reasons: (decisionRow.reasons ?? []) as Reason[],
      risk_score: decisionRow.riskScore as DecisionResult["risk_score"],
    };
    const policyDoc = await loadPolicyDocument(taskRow.tenantId, decisionRow.matchedPolicy);
    const [toolRow] = await db()
      .select()
      .from(tools)
      .where(and(eq(tools.tenantId, taskRow.tenantId), eq(tools.name, intentRow.tool)));

    const phase = await runExecutionPhase({
      tenantId: taskRow.tenantId,
      taskId: intentRow.taskId,
      agentId: intentRow.agentId,
      agentKey: agentRow.agentKey,
      intentId: intentRow.id,
      tool: intentRow.tool,
      toolRow: toolRow ?? null,
      normalized,
      decision,
      decisionId: decisionRow.id,
      policyDoc,
      args: (intentRow.argumentsRedacted ?? {}) as Record<string, unknown>,
    });

    return Response.json({
      ok: true,
      data: {
        intent_id: intentRow.id,
        decision: "escalate",
        matched_policy: decisionRow.matchedPolicy,
        matched_rule_id: decisionRow.matchedRuleId,
        reasons: decisionRow.reasons ?? [],
        risk_score: decisionRow.riskScore,
        approval_id: approval.id,
        payment_required: phase.payment_required,
        capability: phase.capability,
        payment: null,
        execution: phase.execution,
      },
    });
  } catch (err) {
    if (err instanceof GatewayError) {
      return Response.json(
        { ok: false, error: { code: err.code, message: err.message } },
        { status: HTTP_STATUS[err.code] ?? 500 },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      { ok: false, error: { code: "INTERNAL", message } },
      { status: 500 },
    );
  }
}
