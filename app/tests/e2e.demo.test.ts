import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "../src/server/db/client";
import {
  agents, auditEvents, capabilities, tasks, tenants, tools,
} from "../src/server/db/schema";
import { runToolCall } from "../src/server/gateway/orchestrator";
import { consumeCapability } from "../src/server/capability/verify";
import {
  AutoContextProvider, setContextProvider,
} from "../src/server/gateway/context/provider";
import { GraphContextProvider } from "../src/server/gateway/context/graphProvider";
import { config } from "../src/server/config";
import { seed } from "../src/server/demo/seed";
import { POST as scannerPOST } from "../src/app/api/services/scanner/scan/route";
import { POST as resolvePOST } from "../src/app/api/approvals/[id]/resolve/route";
import { GET as traceGET } from "../src/app/api/audit/trace/[taskId]/route";

// plan-10 e2e smoke: throwaway tenant test-plan-10 seeded with the EXACT demo
// fixtures (same seed the demo script uses), scanner served on loopback.
// The happy-path chain needs a funded testnet operator (25¢ settles live);
// without HEDERA_OPERATOR_* it skips cleanly — never faked.
vi.hoisted(() => {
  process.env.DEMO_TENANT_SLUG = "test-plan-10";
});

const TENANT = "test-plan-10";
const AGENT_KEY = "agent:8472";

const hasSettlementEnv = !!process.env.HEDERA_OPERATOR_ID && !!process.env.HEDERA_OPERATOR_KEY;

let tenantId = "";
let agent8472Id = "";
let lab1Id = "";
let scannerUrl = "";
let liveReady = false;

const scannerServer = http.createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const webReq = new Request(`http://127.0.0.1${req.url ?? "/"}`, {
    method: req.method ?? "POST",
    headers: req.headers as Record<string, string>,
    body: chunks.length ? Buffer.concat(chunks) : undefined,
  });
  let webRes: Response;
  try {
    webRes = await scannerPOST(webReq);
  } catch (err) {
    webRes = Response.json({ ok: false, error: { code: "INTERNAL", message: String(err) } }, { status: 500 });
  }
  res.statusCode = webRes.status;
  for (const [key, value] of webRes.headers) res.setHeader(key, value);
  res.end(Buffer.from(await webRes.arrayBuffer()));
});

type Origin = "agent" | "payment_discovery";

function call(taskId: string, agentKey: string, tool: string, args: Record<string, unknown>, origin?: Origin) {
  return runToolCall(
    { task_id: taskId, agent_key: agentKey, tool, arguments: args, ...(origin ? { origin } : {}) } as never,
  );
}

function resolve(approvalId: string, outcome: "approved" | "rejected") {
  return resolvePOST(
    new Request("http://test/api/approvals/x/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outcome }),
    }),
    { params: Promise.resolve({ id: approvalId }) },
  );
}

async function newTask(title: string, budgetUsdCents: number, agentId: string): Promise<string> {
  const [row] = await db()
    .insert(tasks)
    .values({ tenantId, agentId, title, budgetUsdCents, status: "open" })
    .returning();
  return row.id;
}

async function taskEventTypes(taskId: string): Promise<string[]> {
  const rows = await db().select().from(auditEvents).where(eq(auditEvents.taskId, taskId)).orderBy(asc(auditEvents.id));
  return rows.map((r) => r.eventType);
}

// The plan's chain is a SUBSEQUENCE of the full ordered audit trail: the live
// pipeline also emits intent.created / policy.evaluated per tool-call
// (ingest/orchestrator) and capability.consumed per consume (verify.ts),
// which the chain elides for readability. Every escalation still emits BOTH
// capability.escalated and ledger.approval.requested (orchestrator), so the
// needle keeps both — nothing structural is elided, only per-step repeats.
function assertSubsequence(haystack: string[], needle: string[]): void {
  let j = 0;
  for (const h of haystack) {
    if (h === needle[j]) j++;
    if (j === needle.length) break;
  }
  expect(
    j === needle.length,
    j === needle.length
      ? ""
      : `event chain diverged at [${j}] expected "${needle[j]}" (matched ${j}/${needle.length}).\nfull trail: ${haystack.join(" → ")}`,
  ).toBe(true);
}

// Run fn with temporary env: config() is a lazy singleton, so dropping its
// cache around the swap re-parses process.env for the duration. Serial file
// (fileParallelism:false) — no concurrent test can observe the swap.
async function withEnv<T>(vars: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    process.env[k] = v;
  }
  delete (globalThis as Record<string, unknown>).__cubicConfig;
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    delete (globalThis as Record<string, unknown>).__cubicConfig;
  }
}

beforeAll(async () => {
  // Graph trust path for the low-reputation fixture (fixture identity
  // short-circuits in-process, never networked); neutral 0.80 for agent:8472,
  // so every allow-path outcome matches the static provider exactly.
  setContextProvider(new GraphContextProvider());
  await seed();
  const [tenant] = await db().select().from(tenants).where(eq(tenants.slug, TENANT));
  tenantId = tenant.id;
  const [a8472] = await db().select().from(agents).where(and(eq(agents.tenantId, tenantId), eq(agents.agentKey, AGENT_KEY)));
  agent8472Id = a8472.id;
  const [lab1] = await db().select().from(agents).where(and(eq(agents.tenantId, tenantId), eq(agents.agentKey, "agent:lab-1")));
  lab1Id = lab1.id;

  await new Promise<void>((resolve, reject) => {
    scannerServer.once("error", reject);
    scannerServer.listen(0, "127.0.0.1", () => resolve());
  });
  scannerUrl = `http://127.0.0.1:${(scannerServer.address() as AddressInfo).port}/api/services/scanner/scan`;
  await db().update(tools).set({ executorConfig: { endpoint: scannerUrl } }).where(eq(tools.tenantId, tenantId));

  // Live-readiness gate for the happy-path chain: funded operator that covers
  // the 25¢ demo price at the live mirror rate. Anything missing → warn and
  // let the live tests return early (blocked-on-env, never faked).
  if (hasSettlementEnv) {
    try {
      const c = config();
      const rateRes = await fetch("https://testnet.mirrornode.hedera.com/api/v1/network/exchangerate", { signal: AbortSignal.timeout(5000) });
      const rate = (await rateRes.json()) as { current_rate?: { cent_equivalent?: number; hbar_equivalent?: number } };
      const cent = rate.current_rate?.cent_equivalent;
      const hbar = rate.current_rate?.hbar_equivalent;
      const balRes = await fetch(
        `https://testnet.mirrornode.hedera.com/api/v1/accounts/${encodeURIComponent(c.HEDERA_OPERATOR_ID!)}`,
        { signal: AbortSignal.timeout(5000) },
      );
      if (!balRes.ok) {
        console.warn("[e2e.demo] skipping live chain: mirror balance lookup failed (blocked-on-env)");
        return;
      }
      const bal = (await balRes.json()) as { balance?: { balance?: number } };
      const required = typeof cent === "number" && typeof hbar === "number" && cent > 0 && hbar > 0
        ? Math.max(1, Math.round((25 * hbar * 1e8) / cent))
        : null;
      if (required !== null && (bal.balance?.balance ?? 0) >= required) {
        liveReady = true;
      } else {
        console.warn(`[e2e.demo] skipping live chain: operator balance ${(bal.balance?.balance ?? 0)} below ~${required} tinybars (top up at portal.hedera.com)`);
      }
    } catch {
      console.warn("[e2e.demo] skipping live chain: mirror unreachable (blocked-on-env)");
    }
  } else {
    console.warn("[e2e.demo] skipping live chain: HEDERA_OPERATOR_* not configured (blocked-on-env, never faked)");
  }
}, 60000);

afterAll(async () => {
  scannerServer.close();
  setContextProvider(new AutoContextProvider());
  await seed(); // demo-tenant rows only: clears e2e artifacts, restores fixtures
  delete process.env.DEMO_TENANT_SLUG;
  delete (globalThis as Record<string, unknown>).__cubicConfig; // don't leak the test slug into later files
}, 60000);

describe("plan-10 happy path: ordered event chain", () => {
  it.skipIf(!hasSettlementEnv)("seeded demo task settles 25¢ live and emits the exact chain", async (ctx) => {
    if (!liveReady) ctx.skip(); // blocked-on-env (balance/facilitator/mirror) — honest skip, never a vacuous pass
    const [task] = await db()
      .select()
      .from(tasks)
      .where(and(eq(tasks.tenantId, tenantId), eq(tasks.agentId, agent8472Id), eq(tasks.status, "open")))
      .orderBy(desc(tasks.createdAt))
      .limit(1);
    const taskId = task.id;

    const read = await call(taskId, AGENT_KEY, "github.get_pull_request", { repo: "acme/backend", pr: 421 });
    expect(read.ok && read.data.decision).toBe("allow");

    const discovered = await call(taskId, AGENT_KEY, "scanner.scan", { target: "acme/backend#421" });
    expect(discovered.ok && discovered.data.payment_required?.price_usd_cents).toBe(25);

    const purchased = await call(
      taskId, AGENT_KEY, "scanner.scan",
      { target: "acme/backend#421", purchase: true, price_usd_cents: 25 }, "payment_discovery",
    );
    expect(purchased.ok && purchased.data.decision).toBe("allow");
    expect(purchased.ok && purchased.data.matched_policy).toBe("payment-v1");
    expect(purchased.ok && purchased.data.payment?.status).toBe("completed");
    expect(purchased.ok && purchased.data.payment?.settlement_ref).toEqual(expect.any(String));

    const merge = await call(taskId, AGENT_KEY, "github.merge_pull_request", { repo: "acme/backend", pr: 421 });
    expect(merge.ok && merge.data.decision).toBe("escalate");
    const mergeRes = await resolve((merge.ok && merge.data.approval_id) as string, "approved");
    const mergeBody = (await mergeRes.json()) as { ok: boolean; data: { capability: unknown; execution: { status: string } } };
    expect(mergeBody.ok).toBe(true);
    expect(mergeBody.data.execution.status).toBe("succeeded");

    const deploy = await call(taskId, AGENT_KEY, "deploy.production", { repo: "acme/backend" });
    expect(deploy.ok && deploy.data.decision).toBe("escalate");
    const deployRes = await resolve((deploy.ok && deploy.data.approval_id) as string, "approved");
    const deployBody = (await deployRes.json()) as { ok: boolean; data: { execution: { status: string } } };
    expect(deployBody.ok).toBe(true);
    expect(deployBody.data.execution.status).toBe("succeeded");

    const attack = await call(taskId, AGENT_KEY, "github.read_file", { repo: "acme/backend", path: ".env.production" });
    expect(attack.ok && attack.data.decision).toBe("deny");

    const done = await call(taskId, AGENT_KEY, "task.complete", {});
    expect(done.ok && done.data.decision).toBe("allow");

    const types = await taskEventTypes(taskId);
    assertSubsequence(types, [
      "intent.created", "policy.evaluated", "capability.issued",
      "service.discovered",
      "payment.requested", "payment.completed",
      // plan-13 note: the purchase consumes the capability runExecutionPhase
      // issued pre-payment (W5 merge restructure) — there is no post-payment
      // re-issue; the purchase execution reads consumed → started → completed.
      "capability.consumed", "tool.execution.started", "tool.execution.completed",
      "capability.escalated", "ledger.approval.requested", "ledger.approval.completed",
      "capability.issued", "tool.execution.completed",
      "capability.escalated", "ledger.approval.requested", "ledger.approval.completed",
      "capability.issued", "tool.execution.completed",
      "capability.denied",
      "task.completed",
    ]);

    const traceRes = await traceGET(new Request("http://test/audit/trace"), { params: Promise.resolve({ taskId }) });
    const traceBody = (await traceRes.json()) as { ok: boolean; data: { events: Array<{ event_type: string }> } };
    expect(traceBody.ok).toBe(true);
    expect(traceBody.data.events.some((e) => e.event_type === "task.completed")).toBe(true);
  }, 120000);
});

describe("plan-10 adversarial reason codes", () => {
  it("prompt injection → deny secret_resource", async () => {
    const taskId = await newTask("e2e: prompt injection", 50, agent8472Id);
    const r = await call(taskId, AGENT_KEY, "github.read_file", { repo: "acme/backend", path: ".env.production" });
    expect(r.ok && r.data.decision).toBe("deny");
    expect(r.ok && r.data.matched_rule_id).toBe("deny-secret-resources");
    expect(r.ok && r.data.reasons[0]?.code).toBe("secret_resource");
  }, 30000);

  it("over budget → deny budget_exceeded, no payment/execution", async () => {
    const taskId = await newTask("e2e: over budget", 10, agent8472Id);
    const r = await call(taskId, AGENT_KEY, "scanner.scan", { target: "acme/backend#421", purchase: true, price_usd_cents: 25 }, "payment_discovery");
    expect(r.ok && r.data.decision).toBe("deny");
    expect(r.ok && r.data.matched_policy).toBe("payment-v1");
    expect(r.ok && r.data.matched_rule_id).toBe("budget");
    expect(r.ok && r.data.reasons[0]?.code).toBe("budget_exceeded");
    expect(r.ok && r.data.payment).toBeNull();
    expect(r.ok && r.data.execution).toBeNull();
  }, 30000);

  it("expired capability → rejected expired", async () => {
    const taskId = await newTask("e2e: expired capability", 50, agent8472Id);
    const d = await call(taskId, AGENT_KEY, "scanner.scan", { target: "acme/backend#421" });
    expect(d.ok && d.data.capability).not.toBeNull();
    const capId = (d.ok && d.data.capability!.capability_id) as string;
    await db().update(capabilities).set({ expiresAt: new Date(Date.now() - 60_000).toISOString() }).where(eq(capabilities.id, capId));
    const consumed = await consumeCapability(capId, { action: "scan", resource: "acme/backend#421" });
    expect(consumed).toEqual({ status: "rejected", reason: "expired" });
    expect(await taskEventTypes(taskId)).toContain("capability.rejected");
  }, 30000);

  it("tampered capability → rejected not_found", async () => {
    const consumed = await consumeCapability(randomUUID(), { action: "scan", resource: "acme/backend#421" });
    expect(consumed).toEqual({ status: "rejected", reason: "not_found" });
  }, 30000);

  it("failed payment → payment.failed, capability revoked, zero tool.execution.*", async () => {
    await withEnv({ X402_SIMULATE_FAILURE: "1" }, async () => {
      const taskId = await newTask("e2e: failed payment", 50, agent8472Id);
      const r = await call(taskId, AGENT_KEY, "scanner.scan", { target: "acme/backend#421", purchase: true, price_usd_cents: 25 }, "payment_discovery");
      expect(r.ok && r.data.decision).toBe("allow");
      expect(r.ok && r.data.payment).toEqual({
        payment_id: expect.any(String),
        status: "failed",
        settlement_ref: null,
        error_code: "SIMULATED_SETTLEMENT_FAILURE",
      });
      expect(r.ok && r.data.execution).toBeNull();
      const capRows = await db().select().from(capabilities).where(eq(capabilities.id, (r.ok && r.data.capability!.capability_id) as string));
      expect(capRows[0]?.status).toBe("revoked");
      const types = await taskEventTypes(taskId);
      expect(types).toContain("payment.failed");
      expect(types.some((t) => t.startsWith("tool.execution."))).toBe(false);
    });
  }, 30000);

  it.skipIf(!process.env.THEGRAPH_API_KEY && !process.env.AGENT0_SUBGRAPH_URL)("low reputation → escalate reputation_below_threshold", async () => {
    const taskId = await newTask("e2e: low reputation", 50, lab1Id);
    const r = await call(taskId, "agent:lab-1", "github.get_pull_request", { repo: "acme/backend", pr: 421 });
    expect(r.ok && r.data.decision).toBe("escalate");
    expect(r.ok && r.data.reasons.some((x) => x.code === "reputation_below_threshold")).toBe(true);
  }, 30000);
});

// Fixture-drift guard: the demo script and this file share seed() — if the
// seeded task shape changes, both must be updated together.
describe("plan-10 demo fixtures", () => {
  it("seeded task for agent:8472 carries the $0.50 demo budget", async () => {
    const seeded = await db()
      .select()
      .from(tasks)
      .where(and(eq(tasks.tenantId, tenantId), eq(tasks.agentId, agent8472Id)))
      .orderBy(asc(tasks.createdAt))
      .limit(1);
    expect(seeded[0]?.title).toMatch(/PR #421/);
    expect(seeded[0]?.budgetUsdCents).toBe(50);
  }, 30000);
});
