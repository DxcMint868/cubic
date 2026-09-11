import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import {
  approvals, auditEvents, capabilities, decisions, executions, intents, payments, tasks,
} from "@/server/db/schema";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ taskId: string }> },
) {
  try {
    const { taskId } = await ctx.params;
    if (!z.string().uuid().safeParse(taskId).success) {
      return Response.json(
        { ok: false, error: { code: "INVALID_REQUEST", message: "taskId must be a uuid" } },
        { status: 400 },
      );
    }

    const [task] = await db().select().from(tasks).where(eq(tasks.id, taskId));
    if (!task) {
      return Response.json(
        { ok: false, error: { code: "TASK_NOT_FOUND", message: `task not found: ${taskId}` } },
        { status: 404 },
      );
    }

    const intentRows = await db()
      .select()
      .from(intents)
      .where(eq(intents.taskId, taskId))
      .orderBy(asc(intents.createdAt));
    const intentIds = intentRows.map((row) => row.id);

    const decisionRows = intentIds.length
      ? await db().select().from(decisions).where(inArray(decisions.intentId, intentIds)).orderBy(asc(decisions.createdAt))
      : [];
    const decisionIds = decisionRows.map((row) => row.id);

    const capabilityRows = decisionIds.length
      ? await db().select().from(capabilities).where(inArray(capabilities.decisionId, decisionIds))
      : [];
    const capabilityIds = capabilityRows.map((row) => row.id);

    const [approvalRows, paymentRows, executionRows] = await Promise.all([
      decisionIds.length
        ? db().select().from(approvals).where(inArray(approvals.decisionId, decisionIds)).orderBy(asc(approvals.requestedAt))
        : Promise.resolve([]),
      capabilityIds.length
        ? db().select().from(payments).where(inArray(payments.capabilityId, capabilityIds)).orderBy(asc(payments.createdAt))
        : Promise.resolve([]),
      capabilityIds.length
        ? db().select().from(executions).where(inArray(executions.capabilityId, capabilityIds)).orderBy(asc(executions.startedAt))
        : Promise.resolve([]),
    ]);

    const paymentsByCapability = new Map<string, typeof paymentRows>();
    for (const row of paymentRows) {
      paymentsByCapability.set(row.capabilityId, [...(paymentsByCapability.get(row.capabilityId) ?? []), row]);
    }
    const executionsByCapability = new Map<string, typeof executionRows>();
    for (const row of executionRows) {
      executionsByCapability.set(row.capabilityId, [...(executionsByCapability.get(row.capabilityId) ?? []), row]);
    }
    const approvalsByDecision = new Map<string, typeof approvalRows>();
    for (const row of approvalRows) {
      approvalsByDecision.set(row.decisionId, [...(approvalsByDecision.get(row.decisionId) ?? []), row]);
    }

    const chain = intentRows.map((intentRow) => {
      const decisionRow = decisionRows.find((row) => row.intentId === intentRow.id) ?? null;
      const capabilityRow = decisionRow
        ? capabilityRows.find((row) => row.decisionId === decisionRow.id) ?? null
        : null;
      return {
        intent: {
          id: intentRow.id,
          tool: intentRow.tool,
          resource: intentRow.resource,
          arguments_redacted: intentRow.argumentsRedacted,
          risk_class: intentRow.riskClass,
          origin: intentRow.origin,
          normalized: intentRow.normalized,
          created_at: intentRow.createdAt,
        },
        decision: decisionRow
          ? {
              id: decisionRow.id,
              decision: decisionRow.decision,
              matched_policy: decisionRow.matchedPolicy,
              matched_rule_id: decisionRow.matchedRuleId,
              reasons: decisionRow.reasons,
              context_snapshot_hash: decisionRow.contextSnapshotHash,
              risk_score: decisionRow.riskScore,
              created_at: decisionRow.createdAt,
            }
          : null,
        capability: capabilityRow
          ? {
              id: capabilityRow.id,
              subject: capabilityRow.subject,
              action: capabilityRow.action,
              resource: capabilityRow.resource,
              constraints: capabilityRow.constraints,
              budget_usd_cents: capabilityRow.budgetUsdCents,
              expires_at: capabilityRow.expiresAt,
              nonce: capabilityRow.nonce,
              policy_hash: capabilityRow.policyHash,
              status: capabilityRow.status,
            }
          : null,
        payments: capabilityRow
          ? (paymentsByCapability.get(capabilityRow.id) ?? []).map((row) => ({
              id: row.id,
              service: row.service,
              network: row.network,
              amount_usd_cents: row.amountUsdCents,
              status: row.status,
              x402_ref: row.x402Ref,
              created_at: row.createdAt,
              settled_at: row.settledAt,
            }))
          : [],
        executions: capabilityRow
          ? (executionsByCapability.get(capabilityRow.id) ?? []).map((row) => ({
              id: row.id,
              tool: row.tool,
              status: row.status,
              executor: row.executor,
              result_summary: row.resultSummary,
              error: row.error,
              started_at: row.startedAt,
              completed_at: row.completedAt,
            }))
          : [],
        approvals: decisionRow
          ? (approvalsByDecision.get(decisionRow.id) ?? []).map((row) => ({
              id: row.id,
              type: row.type,
              status: row.status,
              provider: row.provider,
              provider_ref: row.providerRef,
              requested_at: row.requestedAt,
              completed_at: row.completedAt,
            }))
          : [],
      };
    });

    const eventRows = await db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.taskId, taskId))
      .orderBy(asc(auditEvents.id));

    return Response.json({
      ok: true,
      data: {
        task: {
          id: task.id,
          title: task.title,
          budget_usd_cents: task.budgetUsdCents,
          status: task.status,
        },
        chain,
        events: eventRows.map((row) => ({
          event_type: row.eventType,
          occurred_at: row.createdAt,
          payload: row.payload,
        })),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      { ok: false, error: { code: "INTERNAL", message } },
      { status: 500 },
    );
  }
}
