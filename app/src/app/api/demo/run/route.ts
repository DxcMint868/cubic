import { and, desc, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { agents, approvals, decisions, intents, tasks, tenants, tools } from "@/server/db/schema";
import { config } from "@/server/config";
import { emit } from "@/server/events/bus";
import type { DecisionResult, NormalizedIntent, Reason, RiskClass } from "@/server/domain";
import { loadPolicyDocument, runExecutionPhase, runToolCall } from "@/server/gateway/orchestrator";
import { seed } from "@/server/demo/seed";

export const dynamic = "force-dynamic";

// Narrow fidelity with the canonical resolve route: an already-resolved
// approval is a 409, not a 500.
class ResolveConflict extends Error {
  readonly status = 409;
  readonly code = "INVALID_REQUEST";
}

// plan-10 convenience route: seed + the happy-path sequence server-side for
// live demos. Mirrors app/src/server/demo/agent.ts step for step (same order,
// same assertions); the scripted agent remains the canonical video path.
export async function POST() {
  try {
    if (!process.env.HEDERA_OPERATOR_ID || !process.env.HEDERA_OPERATOR_KEY) {
      return Response.json(
        {
          ok: false,
          error: {
            code: "INTERNAL",
            message: "demo/run blocked: HEDERA_OPERATOR_ID / HEDERA_OPERATOR_KEY not set — the paid step cannot settle. Set them in app/.env.local and re-run.",
          },
        },
        { status: 500 },
      );
    }

    const fail = (step: string, message: string) =>
      Response.json({ ok: false, error: { code: "INTERNAL", message: `demo/run aborted [${step}]: ${message}` } }, { status: 500 });

    await seed();

    const [tenant] = await db().select().from(tenants).where(eq(tenants.slug, config().DEMO_TENANT_SLUG));
    if (!tenant) return fail("task", "demo tenant missing after seed");
    const [agent] = await db().select().from(agents).where(and(eq(agents.tenantId, tenant.id), eq(agents.agentKey, "agent:8472")));
    if (!agent) return fail("task", "agent:8472 missing after seed");
    const [task] = await db()
      .select()
      .from(tasks)
      .where(and(eq(tasks.tenantId, tenant.id), eq(tasks.agentId, agent.id), eq(tasks.status, "open")))
      .orderBy(desc(tasks.createdAt))
      .limit(1);
    if (!task) return fail("task", "no open task for agent:8472 after seed");
    const taskId = task.id;

    const call = (tool: string, args: Record<string, unknown>, origin?: "agent" | "payment_discovery") =>
      runToolCall({ task_id: taskId, agent_key: "agent:8472", tool, arguments: args, ...(origin ? { origin } : {}) } as never);

    const read = await call("github.get_pull_request", { repo: "acme/backend", pr: 421 });
    if (!read.ok || read.data.decision !== "allow") return fail("get-pr", `expected allow, got ${JSON.stringify(read)}`);

    const discovered = await call("scanner.scan", { target: "acme/backend#421" });
    if (!discovered.ok || !discovered.data.payment_required) return fail("discover", `expected payment_required, got ${JSON.stringify(discovered)}`);
    if (discovered.ok && discovered.data.payment_required.price_usd_cents !== 25) {
      return fail("discover", `expected price 25¢, got ${discovered.data.payment_required.price_usd_cents}¢`);
    }

    const purchased = await call(
      "scanner.scan",
      { target: "acme/backend#421", purchase: true, price_usd_cents: 25 },
      "payment_discovery",
    );
    if (!purchased.ok || purchased.data.decision !== "allow" || purchased.data.payment?.status !== "completed") {
      return fail("purchase", `expected allow + completed payment, got ${JSON.stringify(purchased)}`);
    }
    const settlementRef = purchased.data.payment.settlement_ref;

    const merge = await call("github.merge_pull_request", { repo: "acme/backend", pr: 421 });
    if (!merge.ok || merge.data.decision !== "escalate" || !merge.data.approval_id) {
      return fail("merge", `expected escalate + approval, got ${JSON.stringify(merge)}`);
    }
    // Dev stand-in for the Ledger device approval (same framing as agent.ts:
    // on hardware this is the Ledger approval; the event chain is identical).
    const mergeExec = await resolveApproval(merge.data.approval_id);
    if (!mergeExec.capability || mergeExec.execution?.status !== "succeeded") {
      return fail("resolve-merge", `expected capability + succeeded execution, got ${JSON.stringify(mergeExec)}`);
    }

    const deploy = await call("deploy.production", { repo: "acme/backend" });
    if (!deploy.ok || deploy.data.decision !== "escalate" || !deploy.data.approval_id) {
      return fail("deploy", `expected escalate + approval, got ${JSON.stringify(deploy)}`);
    }
    const deployExec = await resolveApproval(deploy.data.approval_id);
    if (deployExec.execution?.status !== "succeeded") {
      return fail("resolve-deploy", `expected succeeded execution, got ${JSON.stringify(deployExec)}`);
    }

    const attack = await call("github.read_file", { repo: "acme/backend", path: ".env.production" });
    if (!attack.ok || attack.data.decision !== "deny" || !attack.data.reasons.some((r) => r.code === "secret_resource")) {
      return fail("attack", `expected deny secret_resource, got ${JSON.stringify(attack)}`);
    }

    const done = await call("task.complete", {});
    if (!done.ok || done.data.decision !== "allow" || done.data.execution?.status !== "succeeded") {
      return fail("complete", `expected allow + succeeded execution, got ${JSON.stringify(done)}`);
    }

    return Response.json({
      ok: true,
      data: {
        task_id: taskId,
        trace_path: `/api/audit/trace/${taskId}`,
        settlement_ref: settlementRef,
        beats: [
          { beat: 2, step: "read PR through the gateway", outcome: "ALLOW" },
          { beat: 4, step: "paid scan: 402 → budget policy → settlement", outcome: "PAID 25¢" },
          { beat: 5, step: "merge + deploy via approval (dev stand-in)", outcome: "APPROVED" },
          { beat: 6, step: "prompt-injected secret read", outcome: "DENIED" },
          { beat: 7, step: "trace above; same events stream to /network", outcome: "LIVE" },
        ],
      },
    });
  } catch (err) {
    if (err instanceof ResolveConflict) {
      return Response.json({ ok: false, error: { code: err.code, message: err.message } }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: { code: "INTERNAL", message } }, { status: 500 });
  }
}

// Mirrors app/src/app/api/approvals/[id]/resolve/route.ts (approved arm):
// claim the pending row, emit ledger.approval.completed, continue into the
// shared execution phase.
async function resolveApproval(approvalId: string): Promise<{
  capability: unknown;
  execution: { execution_id: string; status: "succeeded" | "failed"; result_summary: string | null } | null;
}> {
  const claimed = await db()
    .update(approvals)
    .set({ status: "approved", completedAt: new Date().toISOString() })
    .where(and(eq(approvals.id, approvalId), eq(approvals.status, "pending")))
    .returning();
  if (claimed.length === 0) throw new ResolveConflict(`approval already resolved or missing: ${approvalId}`);

  const [decisionRow] = await db().select().from(decisions).where(eq(decisions.id, claimed[0].decisionId));
  if (!decisionRow) throw new Error(`decision row missing for approval ${approvalId}`);
  const [intentRow] = await db().select().from(intents).where(eq(intents.id, decisionRow.intentId));
  if (!intentRow || !intentRow.taskId) throw new Error(`intent row missing for approval ${approvalId}`);
  const [taskRow] = await db().select().from(tasks).where(eq(tasks.id, intentRow.taskId));
  if (!taskRow) throw new Error(`task row missing for approval ${approvalId}`);
  const [agentRow] = await db().select().from(agents).where(eq(agents.id, intentRow.agentId));
  if (!agentRow) throw new Error(`agent row missing for approval ${approvalId}`);

  await emit(
    {
      event_type: "ledger.approval.completed",
      tenant_id: taskRow.tenantId,
      task_id: intentRow.taskId,
      agent_id: intentRow.agentId,
      payload: {
        approval_id: claimed[0].id,
        decision_id: decisionRow.id,
        provider: config().LEDGER_PROVIDER,
        outcome: "approved",
      },
    },
    { agent_key: agentRow.agentKey, risk_class: intentRow.riskClass as RiskClass },
  );

  const normalized = intentRow.normalized as NormalizedIntent | null;
  if (!normalized) throw new Error(`intent ${intentRow.id} has no normalized intent`);
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

  return runExecutionPhase({
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
}
