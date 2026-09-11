import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "../src/server/db/client";
import {
  agents, auditEvents, capabilities, decisions, executions, intents,
  payments, policies, tasks, tenants, tools,
} from "../src/server/db/schema";
import { runToolCall } from "../src/server/gateway/orchestrator";
import { config } from "../src/server/config";
import { clearRegisteredExecutors } from "../src/server/executors/registry";
import { POST as scannerPOST } from "../src/app/api/services/scanner/scan/route";
import { GET as traceGET } from "../src/app/api/audit/trace/[taskId]/route";

// AC1 (live, env-gated): the real 402 → payment_required → purchase allow →
// Blocky402 settlement on Hedera testnet → verifySettlement → report chain.
// Skips cleanly without operator env, without facilitator support, or when the
// operator balance cannot cover the price. Never fakes a settlement.
vi.hoisted(() => {
  process.env.DEMO_TENANT_SLUG = "test-plan-05-live";
  // Cheap-but-real: 1 USD cent keeps each live run at ~0.13 HBAR of testnet gas.
  process.env.X402_SCANNER_PRICE_CENTS = "1";
});

const TENANT = "test-plan-05-live";
const AGENT_KEY = "agent:test-05-live";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let tenantId: string;
let agentId: string;
let scannerUrl: string;

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

const TOOLS = [
  {
    name: "scanner.scan", category: "security", default_risk_class: "medium",
    executor: "scanner", executor_config: {},
  },
];

const DEFAULT_RULES = [
  { id: "tool-allowlist", type: "tool_allowlist", tools: TOOLS.map((t) => t.name), decision: "deny", reason: "tool_not_allowed" },
  { id: "default-allow", type: "default", decision: "allow", reason: "policy_default_allow" },
];

const PAYMENT_RULES = [
  { id: "budget", type: "budget", decision: "deny", reason: "budget_exceeded" },
  { id: "default-allow", type: "default", decision: "allow", reason: "policy_default_allow" },
];

async function newTask(title: string, budgetUsdCents: number): Promise<string> {
  const [row] = await db()
    .insert(tasks)
    .values({ tenantId, agentId, title, budgetUsdCents, status: "open" })
    .returning();
  return row.id;
}

function call(
  taskId: string,
  tool: string,
  args: Record<string, unknown>,
  origin?: "agent" | "payment_discovery",
) {
  return runToolCall(
    { task_id: taskId, agent_key: AGENT_KEY, tool, arguments: args, ...(origin ? { origin } : {}) } as never,
  );
}

beforeAll(async () => {
  const c = config();
  if (!c.HEDERA_OPERATOR_ID || !c.HEDERA_OPERATOR_KEY) {
    console.warn("[x402.live] skipping: HEDERA_OPERATOR_* not configured (blocked-on-env, never faked)");
    return;
  }
  // Facilitator must advertise the Hedera kind; mirror must be reachable.
  let supported: { kinds?: Array<{ network?: string; extra?: { feePayer?: string } }> } | null = null;
  try {
    const res = await fetch("https://api.testnet.blocky402.com/supported", { signal: AbortSignal.timeout(5000) });
    supported = (await res.json()) as { kinds?: Array<{ network?: string; extra?: { feePayer?: string } }> } | null;
  } catch {
    console.warn("[x402.live] skipping: Blocky402 facilitator unreachable");
    return;
  }
  if (!supported?.kinds?.some((k) => k.network === "hedera:testnet" && k.extra?.feePayer)) {
    console.warn("[x402.live] skipping: facilitator does not advertise hedera:testnet with a feePayer");
    return;
  }
  // Operator balance guard: refuse to attempt settlement it cannot cover.
  // Uses the LIVE mirror exchange rate (no magic constants); if the mirror is
  // unreachable, skip too — never spend unverified.
  const priceCents = config().X402_SCANNER_PRICE_CENTS;
  let requiredTinybars: number | null = null;
  try {
    const rateRes = await fetch(
      `https://testnet.mirrornode.hedera.com/api/v1/network/exchangerate`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!rateRes.ok) {
      console.warn("[x402.live] skipping: mirror exchange-rate lookup failed (blocked-on-env)");
      return;
    }
    const rate = (await rateRes.json()) as { current_rate?: { cent_equivalent?: number; hbar_equivalent?: number } };
    const cent = rate.current_rate?.cent_equivalent;
    const hbar = rate.current_rate?.hbar_equivalent;
    if (typeof cent !== "number" || typeof hbar !== "number" || cent <= 0 || hbar <= 0) {
      console.warn("[x402.live] skipping: unusable exchange-rate payload (blocked-on-env)");
      return;
    }
    requiredTinybars = Math.max(1, Math.round((priceCents * hbar * 1e8) / cent));
  } catch {
    console.warn("[x402.live] skipping: mirror exchange-rate lookup failed (blocked-on-env)");
    return;
  }
  try {
    const res = await fetch(
      `https://testnet.mirrornode.hedera.com/api/v1/accounts/${encodeURIComponent(c.HEDERA_OPERATOR_ID)}?balance=true`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) {
      console.warn("[x402.live] skipping: mirror balance lookup failed (blocked-on-env)");
      return;
    }
    const body = (await res.json()) as { balance?: { balance?: number } };
    const balance = body.balance?.balance ?? 0;
    if (balance < requiredTinybars) {
      console.warn(
        `[x402.live] skipping: operator balance ${balance} tinybars below the required ~${requiredTinybars} (blocked-on-env)`,
      );
      return;
    }
  } catch {
    console.warn("[x402.live] skipping: mirror balance lookup failed (blocked-on-env)");
    return;
  }

  const [tenant] = await db()
    .insert(tenants)
    .values({ slug: TENANT, name: "plan-05 live throwaway" })
    .onConflictDoUpdate({ target: tenants.slug, set: { name: "plan-05 live throwaway" } })
    .returning();
  tenantId = tenant.id;
  const [agent] = await db()
    .insert(agents)
    .values({
      tenantId, agentKey: AGENT_KEY, name: "test-05-live", environment: "demo",
      status: "active", declaredCapabilities: TOOLS.map((t) => t.name),
    })
    .returning();
  agentId = agent.id;
  await db().delete(tools).where(eq(tools.tenantId, tenantId));
  await db().insert(tools).values(TOOLS.map((t) => ({
    tenantId, name: t.name, category: t.category, defaultRiskClass: t.default_risk_class,
    executor: t.executor, executorConfig: { ...t.executor_config },
  })));
  await db().delete(policies).where(eq(policies.tenantId, tenantId));
  await db().insert(policies).values([
    { tenantId, name: "default-v1", version: 1, rules: DEFAULT_RULES.map((r) => ({ ...r })) },
    { tenantId, name: "payment-v1", version: 1, rules: PAYMENT_RULES.map((r) => ({ ...r })) },
  ]);

  await new Promise<void>((resolve, reject) => {
    scannerServer.once("error", reject);
    scannerServer.listen(0, "127.0.0.1", () => resolve());
  });
  scannerUrl = `http://127.0.0.1:${(scannerServer.address() as AddressInfo).port}/api/services/scanner/scan`;
  await db().update(tools).set({ executorConfig: { endpoint: scannerUrl } })
    .where(eq(tools.tenantId, tenantId));
}, 60000);

afterAll(async () => {
  clearRegisteredExecutors();
  scannerServer.close();
  if (!tenantId) {
    delete process.env.DEMO_TENANT_SLUG;
    delete process.env.X402_SCANNER_PRICE_CENTS;
    return;
  }
  const tagents = await db().select().from(agents).where(eq(agents.tenantId, tenantId));
  const aids = tagents.map((a) => a.id);
  const tintents = aids.length ? await db().select().from(intents).where(inArray(intents.agentId, aids)) : [];
  const iids = tintents.map((i) => i.id);
  const tdecs = iids.length ? await db().select().from(decisions).where(inArray(decisions.intentId, iids)) : [];
  const dids = tdecs.map((d) => d.id);
  const tcaps = dids.length ? await db().select().from(capabilities).where(inArray(capabilities.decisionId, dids)) : [];
  const cids = tcaps.map((c) => c.id);
  if (cids.length) {
    await db().delete(executions).where(inArray(executions.capabilityId, cids));
    await db().delete(payments).where(inArray(payments.capabilityId, cids));
  }
  if (dids.length) await db().delete(capabilities).where(inArray(capabilities.decisionId, dids));
  if (iids.length) await db().delete(decisions).where(inArray(decisions.intentId, iids));
  if (aids.length) await db().delete(intents).where(inArray(intents.agentId, aids));
  await db().delete(auditEvents).where(eq(auditEvents.tenantId, tenantId));
  await db().delete(tasks).where(eq(tasks.tenantId, tenantId));
  await db().delete(agents).where(eq(agents.tenantId, tenantId));
  await db().delete(tools).where(eq(tools.tenantId, tenantId));
  await db().delete(policies).where(eq(policies.tenantId, tenantId));
  await db().delete(tenants).where(eq(tenants.id, tenantId));
  delete process.env.DEMO_TENANT_SLUG;
  delete process.env.X402_SCANNER_PRICE_CENTS;
}, 60000);

describe("plan-05 live Hedera settlement (env-gated)", () => {
  it("discovery round: complete x402 v2 challenge (amount, payTo, extra.feePayer, price)", async () => {
    if (!tenantId) return; // skipped in beforeAll (blocked-on-env)
    const taskId = await newTask("live discovery", 50);
    const result = await call(taskId, "scanner.scan", { target: "acme/backend#421" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.payment_required).not.toBeNull();
    const pr = result.data.payment_required!;
    expect(pr.price_usd_cents).toBe(config().X402_SCANNER_PRICE_CENTS);
    const ch = pr.challenge as Record<string, unknown>;
    expect(ch).toMatchObject({
      scheme: "exact",
      network: "hedera:testnet",
      amount: expect.stringMatching(/^[0-9]+$/),
      payTo: expect.any(String),
      asset: "0.0.0",
      maxTimeoutSeconds: 300,
    });
    const extra = ch.extra as Record<string, unknown>;
    expect(extra.feePayer).toMatch(/^0\.0\.[0-9]+$/);
    expect(extra.price_usd_cents).toBe(config().X402_SCANNER_PRICE_CENTS);
  }, 90000);

  it("AC1 full live chain: purchase allow → Blocky402 settlement → verifySettlement → x402 report", async () => {
    if (!tenantId) return; // skipped in beforeAll (blocked-on-env)
    const taskId = await newTask("live purchase", 50);
    // Discovery first: the agent sees the 402 and its price.
    const discovery = await call(taskId, "scanner.scan", { target: "acme/backend#421" });
    expect(discovery.ok).toBe(true);
    if (!discovery.ok) return;
    const price = discovery.data.payment_required!.price_usd_cents;

    // Purchase follow-up (demo-agent shape: origin payment_discovery).
    const result = await call(
      taskId,
      "scanner.scan",
      { target: "acme/backend#421", purchase: true, price_usd_cents: price },
      "payment_discovery",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const d = result.data;
    expect(d.decision).toBe("allow");
    expect(d.payment).not.toBeNull();
    expect(d.payment!.status).toBe("completed");
    expect(d.payment!.settlement_ref).toMatch(/^0\.0\.[0-9]+@[0-9]+\.[0-9]+$/);
    expect(d.capability).not.toBeNull();
    expect(d.capability!.budget_usd_cents).toBe(price);
    expect(d.execution).not.toBeNull();
    expect(d.execution!.status).toBe("succeeded");
    expect(d.execution!.result_summary).toContain("(x402)");

    // payments row completed with the network-native ref.
    const [paymentRow] = await db().select().from(payments).where(eq(payments.capabilityId, d.capability!.capability_id));
    expect(paymentRow).toMatchObject({
      status: "completed", service: "scanner", network: "hedera", amountUsdCents: price,
      x402Ref: d.payment!.settlement_ref,
    });
    expect(paymentRow.settledAt).toBeTruthy();

    // trace: payment.requested + payment.completed present, capability consumed.
    const res = await traceGET(
      new Request(`http://localhost/api/audit/trace/${taskId}`),
      { params: Promise.resolve({ taskId }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const eventTypes = body.data.events.map((e: { event_type: string }) => e.event_type);
    expect(eventTypes).toContain("payment.requested");
    expect(eventTypes).toContain("payment.completed");
    expect(eventTypes).toContain("tool.execution.completed");
    const chain = body.data.chain.find(
      (e: { intent: { id: string } }) => e.intent?.id === result.data.intent_id,
    );
    expect(chain).toBeDefined();
    expect(chain.payments).toHaveLength(1);
    expect(chain.payments[0]).toMatchObject({ status: "completed", x402_ref: d.payment!.settlement_ref });
  }, 120000);
});
