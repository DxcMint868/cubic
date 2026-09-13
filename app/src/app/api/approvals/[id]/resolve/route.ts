import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { verifyMessage } from "viem";
import { db } from "@/server/db/client";
import { agents, approvals, councils, decisions, intents, tasks, tools } from "@/server/db/schema";
import { emit } from "@/server/events/bus";
import { config } from "@/server/config";
import { approvalSignMessage } from "@/lib/approval-message";
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

const bodySchema = z.object({
  outcome: z.enum(["approved", "rejected"]),
  resolved_by: z.string().min(1).optional(),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/, "signature must be a 65-byte hex string").optional(),
  signer: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "signer must be an address").optional(),
});

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
    // plan-12: approver identity is event-sourced (no schema change) — the
    // approval-completed event records who resolved it; default keeps the
    // demo-operator attribution for body-less callers.
    const resolvedBy = parsed.data.resolved_by ?? "demo-operator";

    // Signed approvals: the wallet signs the canonical message off-chain
    // (EIP-191 personal_sign — the popup the approver sees). The server
    // recovers nothing on trust: viem verifies signature-against-signer, and
    // a mismatch is a 403. The {signer, signature} pair lands in the
    // approval-completed payload, so the HCS fingerprint commits to the very
    // bytes that prove who approved. Unsigned resolves keep today's dev
    // stand-in behavior, labeled as such in the UI.
    let approvalSignature: { signer: string; signature: string } | null = null;
    if (parsed.data.signature != null || parsed.data.signer != null) {
      if (parsed.data.signature == null || parsed.data.signer == null) {
        return Response.json(
          { ok: false, error: { code: "INVALID_REQUEST", message: "signature and signer are required together" } },
          { status: 400 },
        );
      }
      const valid = await verifyMessage({
        address: parsed.data.signer as `0x${string}`,
        message: approvalSignMessage(id, outcome),
        signature: parsed.data.signature as `0x${string}`,
      }).catch(() => false);
      if (!valid) {
        return Response.json(
          { ok: false, error: { code: "CAPABILITY_REJECTED", message: "approval signature does not match signer" } },
          { status: 403 },
        );
      }
      approvalSignature = { signer: parsed.data.signer, signature: parsed.data.signature };
    }

    const [approval] = await db().select().from(approvals).where(eq(approvals.id, id));
    if (!approval) {
      return Response.json(
        { ok: false, error: { code: "INVALID_REQUEST", message: `approval not found: ${id}` } },
        { status: 404 },
      );
    }

    // Council multisig (off-chain, Safe-compatible semantics): when the
    // matched rule named a council, signed resolutions collect member
    // signatures until threshold; any member reject vetoes at once. Unsigned
    // dev resolves bypass councils — today's stand-in behavior, labeled.
    let councilSignatures: Array<{ signer: string; signature: string }> = [];
    if (approval.council && approvalSignature) {
      const [decisionForTenant] = await db().select().from(decisions).where(eq(decisions.id, approval.decisionId));
      if (!decisionForTenant) throw new Error(`approval ${id}: decision row missing`);
      const [intentForTenant] = await db().select().from(intents).where(eq(intents.id, decisionForTenant.intentId));
      if (!intentForTenant?.taskId) throw new Error(`approval ${id}: intent task missing`);
      const [taskForTenant] = await db().select().from(tasks).where(eq(tasks.id, intentForTenant.taskId));
      if (!taskForTenant) throw new Error(`approval ${id}: task row missing`);
      const [council] = await db()
        .select()
        .from(councils)
        .where(and(eq(councils.tenantId, taskForTenant.tenantId), eq(councils.name, approval.council)));
      if (!council) throw new Error(`approval ${id}: council missing ${approval.council}`);
      const members = ((council.members ?? []) as string[]).map((m) => m.toLowerCase());
      if (!members.includes(approvalSignature.signer.toLowerCase())) {
        return Response.json(
          { ok: false, error: { code: "CAPABILITY_REJECTED", message: `signer is not a member of ${approval.council}` } },
          { status: 403 },
        );
      }
      const collected = ((approval.signatures ?? []) as Array<{ signer: string; signature: string }>)
        .filter((s) => s.signer.toLowerCase() !== approvalSignature.signer.toLowerCase());
      collected.push(approvalSignature);
      councilSignatures = collected;
      if (outcome === "approved" && new Set(collected.map((s) => s.signer.toLowerCase())).size < council.threshold) {
        await db().update(approvals).set({ signatures: collected }).where(eq(approvals.id, id));
        return Response.json({
          ok: true,
          data: {
            approval_id: approval.id,
            status: "collecting",
            council: approval.council,
            threshold: council.threshold,
            collected: collected.length,
          },
        }, { status: 202 });
      }
    }

    // Claim the row atomically: only a still-pending approval resolves; a
    // second resolve finds zero updated rows.
    const claimed = await db()
      .update(approvals)
      .set({
        status: outcome,
        completedAt: new Date().toISOString(),
        ...(councilSignatures.length ? { signatures: councilSignatures } : {}),
      })
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
          resolved_by: resolvedBy,
          ...(approvalSignature ? { signer: approvalSignature.signer, signature: approvalSignature.signature } : {}),
          ...(approval.council ? { council: approval.council } : {}),
          ...(councilSignatures.length ? { signatures: councilSignatures } : {}),
          ...(approval.council && !approvalSignature ? { council_bypass: "unsigned-dev-resolve" } : {}),
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
          ...(approvalSignature ? { signer: approvalSignature.signer } : {}),
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
      origin: intentRow.origin ?? "agent",
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
        ...(approvalSignature ? { signer: approvalSignature.signer } : {}),
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
