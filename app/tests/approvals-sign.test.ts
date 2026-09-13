// Signed-approval tests — throwaway tenant test-plan-sign.
// The approver signs the canonical message off-chain (EIP-191); the server
// verifies against the claimed signer and seals {signer, signature} into the
// approval-completed payload (covered by the HCS fingerprint).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

// Council member signer: seed's deploy-council (1-of-1) holds AGENT_OWNER_KEY.
// Random accounts exercise the non-member gate.
function ownerAccount() {
  const key = process.env.AGENT_OWNER_KEY as `0x${string}`;
  if (!key) throw new Error("AGENT_OWNER_KEY missing — council tests need the throwaway owner key");
  return privateKeyToAccount(key);
}
import { db } from "../src/server/db/client";
import {
  agents, approvals, auditEvents, capabilities, councils, decisions, executions,
  intents, networkEvents, payments, policies, tasks, tenants, tools,
} from "../src/server/db/schema";
import { runToolCall } from "../src/server/gateway/orchestrator";
import { seed } from "../src/server/demo/seed";
import { POST as resolvePOST } from "../src/app/api/approvals/[id]/resolve/route";
import { approvalSignMessage } from "../src/lib/approval-message";

vi.hoisted(() => {
  process.env.DEMO_TENANT_SLUG = "test-plan-sign";
});

const TENANT = "test-plan-sign";

let taskId = "";

function resolve(id: string, body: Record<string, unknown>) {
  return resolvePOST(
    new Request("http://test/api/approvals/x/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

beforeAll(async () => {
  await seed();
  const [tenant] = await db().select().from(tenants).where(eq(tenants.slug, TENANT));
  const [agent] = await db()
    .select()
    .from(agents)
    .where(and(eq(agents.tenantId, tenant.id), eq(agents.agentKey, "agent:8472")));
  const [task] = await db()
    .insert(tasks)
    .values({ tenantId: tenant.id, agentId: agent.id, title: "sign test task", budgetUsdCents: 5000, status: "open" })
    .returning();
  taskId = task.id;
}, 120000);

afterAll(async () => {
  const [t] = await db().select().from(tenants).where(eq(tenants.slug, TENANT));
  if (t) {
    const tagents = await db().select().from(agents).where(eq(agents.tenantId, t.id));
    const agentIds = tagents.map((a) => a.id);
    if (agentIds.length) {
      const intentIds = (
        await Promise.all(
          agentIds.map((id) => db().select().from(intents).where(eq(intents.agentId, id))),
        )
      ).flat().map((i) => i.id);
      if (intentIds.length) {
        const tdec = (
          await Promise.all(
            intentIds.map((id) => db().select().from(decisions).where(eq(decisions.intentId, id))),
          )
        ).flat();
        const decIds = tdec.map((d) => d.id);
        if (decIds.length) {
          const tcaps = (
            await Promise.all(
              decIds.map((id) => db().select().from(capabilities).where(eq(capabilities.decisionId, id))),
            )
          ).flat();
          for (const c of tcaps) {
            await db().delete(executions).where(eq(executions.capabilityId, c.id));
            await db().delete(payments).where(eq(payments.capabilityId, c.id));
          }
          for (const id of decIds) {
            await db().delete(approvals).where(eq(approvals.decisionId, id));
            await db().delete(capabilities).where(eq(capabilities.decisionId, id));
          }
        }
        for (const id of intentIds) await db().delete(decisions).where(eq(decisions.intentId, id));
      }
      for (const id of agentIds) await db().delete(intents).where(eq(intents.agentId, id));
    }
    await db().delete(auditEvents).where(eq(auditEvents.tenantId, t.id));
    await db().delete(tasks).where(eq(tasks.tenantId, t.id));
    await db().delete(agents).where(eq(agents.tenantId, t.id));
    await db().delete(tools).where(eq(tools.tenantId, t.id));
    await db().delete(policies).where(eq(policies.tenantId, t.id));
    await db().delete(councils).where(eq(councils.tenantId, t.id));
    await db().delete(tenants).where(eq(tenants.id, t.id));
  }
  const pseudo = createHash("sha256").update("agent:8472|cubic-network-v1").digest("hex").slice(0, 16);
  await db().delete(networkEvents).where(eq(networkEvents.agentPseudonym, pseudo));
  delete process.env.DEMO_TENANT_SLUG;
  delete (globalThis as Record<string, unknown>).__cubicConfig;
}, 120000);

async function escalateMerge(): Promise<string> {
  const r = await runToolCall({
    task_id: taskId,
    agent_key: "agent:8472",
    tool: "github.merge_pull_request",
    arguments: { repo: "acme/backend", pr: 421 },
  });
  if (!r.ok || r.data.decision !== "escalate" || !r.data.approval_id) {
    throw new Error(`setup failed: ${JSON.stringify(r)}`);
  }
  return r.data.approval_id;
}

describe("signed approvals", () => {
  it("valid wallet signature resolves + seals signer/signature into the event", async () => {
    const approvalId = await escalateMerge();
    const account = ownerAccount();
    const signature = await account.signMessage({ message: approvalSignMessage(approvalId, "approved") });
    const res = await resolve(approvalId, { outcome: "approved", signature, signer: account.address });
    const body = (await res.json()) as {
      ok: boolean;
      data: { approval_outcome?: string; signer?: string | null; capability: { action: string } | null; execution: { status: string } | null };
    };
    expect(body.ok).toBe(true);
    expect(body.data.signer).toBe(account.address);
    expect(body.data.capability?.action).toBe("merge_pull_request");
    expect(body.data.execution?.status).toBe("succeeded");

    const rows = await db().select().from(auditEvents).where(eq(auditEvents.taskId, taskId)).orderBy(asc(auditEvents.id));
    const completed = rows.find((e) => e.eventType === "ledger.approval.completed");
    expect((completed?.payload as { signer?: string }).signer).toBe(account.address);
    expect((completed?.payload as { signature?: string }).signature).toBe(signature);
  }, 60000);

  it("signature/signer mismatch is a 403, approval stays pending", async () => {
    const approvalId = await escalateMerge();
    const account = privateKeyToAccount(generatePrivateKey());
    const other = privateKeyToAccount(generatePrivateKey());
    const signature = await account.signMessage({ message: approvalSignMessage(approvalId, "approved") });
    const res = await resolve(approvalId, { outcome: "approved", signature, signer: other.address });
    expect(res.status).toBe(403);
    const [row] = await db().select().from(approvals).where(eq(approvals.id, approvalId));
    expect(row.status).toBe("pending");
  }, 60000);

  it("half a pair (signature without signer) is a 400", async () => {
    const approvalId = await escalateMerge();
    const res = await resolve(approvalId, { outcome: "approved", signature: "0x" + "ab".repeat(65) });
    expect(res.status).toBe(400);
  }, 60000);

  it("unsigned resolves keep the dev stand-in behavior", async () => {
    const approvalId = await escalateMerge();
    const res = await resolve(approvalId, { outcome: "rejected", resolved_by: "demo-operator" });
    const body = (await res.json()) as { ok: boolean; data: { approval_outcome: string; signer?: string | null } };
    expect(body.ok).toBe(true);
    expect(body.data.approval_outcome).toBe("rejected");
    expect(body.data.signer).toBeUndefined();
  }, 60000);

  it("valid signature from a non-member is a 403 (council gate)", async () => {
    const approvalId = await escalateMerge();
    const outsider = privateKeyToAccount(generatePrivateKey());
    const signature = await outsider.signMessage({ message: approvalSignMessage(approvalId, "approved") });
    const res = await resolve(approvalId, { outcome: "approved", signature, signer: outsider.address });
    expect(res.status).toBe(403);
    const [row] = await db().select().from(approvals).where(eq(approvals.id, approvalId));
    expect(row.status).toBe("pending");
    expect(row.council).toBe("deploy-council");
  }, 60000);
});
