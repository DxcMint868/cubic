import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { asc, eq, inArray } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "../src/server/db/client";
import {
  agents, auditEvents, capabilities, councils, decisions, executions, intents,
  networkEvents, payments, policies, tasks, tenants, tools,
} from "../src/server/db/schema";
import { pseudonymFor } from "../src/server/events/projection";
import { runToolCall } from "../src/server/gateway/orchestrator";
import { config } from "../src/server/config";
import { POST as scannerPOST } from "../src/app/api/services/scanner/scan/route";

// plan-05 offline suite: throwaway tenant test-plan-05, own price, settlement
// simulation ON so provider.pay deterministically fails without Hedera env.
// The live (real-settlement) path lives in x402.live.test.ts.
vi.hoisted(() => {
  process.env.DEMO_TENANT_SLUG = "test-plan-05";
  process.env.X402_SCANNER_PRICE_CENTS = "33";
  process.env.X402_SIMULATE_FAILURE = "1";
});

const TENANT = "test-plan-05";
const AGENT_KEY = "agent:test-05";
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
    executor: "scanner", executor_config: {}, // endpoint patched in beforeAll
  },
  { name: "github.get_pull_request", category: "coding", default_risk_class: "low", executor: "github", executor_config: {} },
];

const DEFAULT_RULES = [
  { id: "deny-secret-resources", type: "resource_class", match: ["secret"], decision: "deny", reason: "secret_resource" },
  { id: "tool-allowlist", type: "tool_allowlist", tools: TOOLS.map((t) => t.name), decision: "deny", reason: "tool_not_allowed" },
  { id: "default-allow", type: "default", decision: "allow", reason: "policy_default_allow" },
];

const PAYMENT_RULES = [
  { id: "service-allowlist", type: "service_allowlist", services: ["scanner"], decision: "deny", reason: "service_not_approved" },
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

async function taskEvents(taskId: string) {
  return db().select().from(auditEvents).where(eq(auditEvents.taskId, taskId)).orderBy(asc(auditEvents.id));
}

beforeAll(async () => {
  const [tenant] = await db()
    .insert(tenants)
    .values({ slug: TENANT, name: "plan-05 throwaway" })
    .onConflictDoUpdate({ target: tenants.slug, set: { name: "plan-05 throwaway" } })
    .returning();
  tenantId = tenant.id;
  const [agent] = await db()
    .insert(agents)
    .values({
      tenantId, agentKey: AGENT_KEY, name: "test-05", environment: "demo",
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
}, 30000);

afterAll(async () => {
  scannerServer.close();
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
  await db().delete(councils).where(eq(councils.tenantId, tenantId));
  await db().delete(tenants).where(eq(tenants.id, tenantId));
  await db().delete(networkEvents).where(eq(networkEvents.agentPseudonym, pseudonymFor(AGENT_KEY)));
  delete process.env.DEMO_TENANT_SLUG;
  delete process.env.X402_SCANNER_PRICE_CENTS;
  delete process.env.X402_SIMULATE_FAILURE;
}, 30000);

describe("plan-05 scanner 402 gate", () => {
  it("unpaid POST → HTTP 402, envelope-conformant: code/price/network/challenge inside error", async () => {
    const res = await scannerPOST(
      new Request("http://localhost/api/services/scanner/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: "acme/backend#421" }),
      }),
    );
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("PAYMENT_REQUIRED");
    expect(body.error.message.startsWith("x402 payment required")).toBe(true); // degraded variant allowed
    expect(body.error.price_usd_cents).toBe(config().X402_SCANNER_PRICE_CENTS);
    expect(body.error.price_usd_cents).toBe(33); // config-driven, never hardcoded
    expect(body.error.network).toBe("hedera");
    expect(body.error.challenge).toEqual(
      expect.objectContaining({ scheme: "exact", network: expect.stringMatching(/^hedera:(testnet|mainnet)$/) }),
    );
  }, 30000);

  it("dev bypass: X402_DEV_BYPASS=1 returns the plan-04 dev report with a loud warning line", async () => {
    const warnings: string[] = [];
    const orig = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
    try {
      process.env.X402_DEV_BYPASS = "1";
      const res = await scannerPOST(
        new Request("http://localhost/api/services/scanner/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target: "acme/backend#421" }),
        }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.data.mode).toBe("dev");
      expect(body.data.verdict).toBe("clean");
      expect(body.data.price_usd_cents).toBe(config().X402_SCANNER_PRICE_CENTS);
      expect(warnings.some((w) => w.includes("DEV BYPASS"))).toBe(true);
    } finally {
      console.warn = orig;
      delete process.env.X402_DEV_BYPASS;
    }
  }, 30000);
});

describe("plan-05 payment flow", () => {
  it("AC2 over-budget: task budget 10, price 33 → deny budget_exceeded (payment-v1 budget rule)", async () => {
    const taskId = await newTask("over-budget purchase", 10);
    const result = await call(taskId, "scanner.scan", { target: "acme/backend#421", purchase: true, price_usd_cents: 33 }, "payment_discovery");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const d = result.data;
    expect(d.decision).toBe("deny");
    expect(d.matched_policy).toBe("payment-v1");
    expect(d.matched_rule_id).toBe("budget");
    expect(d.reasons[0]?.code).toBe("budget_exceeded");
    expect(d.capability).toBeNull();
    expect(d.payment).toBeNull();
    expect(d.execution).toBeNull();
    const events = await taskEvents(taskId);
    const types = events.map((e) => e.eventType);
    expect(types).toContain("capability.denied");
    expect(types.some((t) => t.startsWith("payment."))).toBe(false);
    expect(types.some((t) => t.startsWith("tool.execution."))).toBe(false);
  }, 30000);

  it("AC3 simulated settlement failure: payment.failed, capability revoked, zero tool.execution.*, no report", async () => {
    const taskId = await newTask("simulated failure purchase", 50);
    const result = await call(taskId, "scanner.scan", { target: "acme/backend#421", purchase: true, price_usd_cents: 33 }, "payment_discovery");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const d = result.data;
    expect(d.decision).toBe("allow");
    expect(d.capability).not.toBeNull();
    expect(d.capability!.budget_usd_cents).toBe(33);
    expect(d.payment).toEqual({
      payment_id: expect.any(String),
      status: "failed",
      settlement_ref: null,
      error_code: "SIMULATED_SETTLEMENT_FAILURE",
    });
    expect(d.execution).toBeNull();

    const [paymentRow] = await db().select().from(payments).where(eq(payments.capabilityId, d.capability!.capability_id));
    expect(paymentRow).toMatchObject({ status: "failed", service: "scanner", network: "hedera", amountUsdCents: 33 });
    const capRow = await db().select().from(capabilities).where(eq(capabilities.id, d.capability!.capability_id));
    expect(capRow[0]?.status).toBe("revoked");

    const events = await taskEvents(taskId);
    const types = events.map((e) => e.eventType);
    expect(types).toContain("payment.requested");
    const failed = events.find((e) => e.eventType === "payment.failed");
    expect(failed).toBeDefined();
    expect(failed!.payload).toEqual({
      payment_id: paymentRow.id,
      capability_id: d.capability!.capability_id,
      error_code: "SIMULATED_SETTLEMENT_FAILURE",
    });
    expect(types.some((t) => t.startsWith("tool.execution."))).toBe(false);
    const execRows = await db().select().from(executions).where(eq(executions.capabilityId, d.capability!.capability_id));
    expect(execRows).toHaveLength(0);
  }, 30000);

  it("discovery round emits service.discovered with challenge_ref = sha256(JSON.stringify(challenge))", async () => {
    const taskId = await newTask("discovery round", 50);
    const result = await call(taskId, "scanner.scan", { target: "acme/backend#421" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const d = result.data;
    expect(d.decision).toBe("allow");
    expect(d.payment_required).not.toBeNull();
    expect(d.payment_required!.price_usd_cents).toBe(33);
    expect(d.execution).toBeNull();

    const events = await taskEvents(taskId);
    const discovered = events.find((e) => e.eventType === "service.discovered");
    expect(discovered).toBeDefined();
    const expectedRef = createHash("sha256")
      .update(JSON.stringify(d.payment_required!.challenge))
      .digest("hex");
    expect(discovered!.payload).toEqual({
      intent_id: d.intent_id,
      service: "scanner",
      price_usd_cents: 33,
      challenge_ref: expectedRef,
    });
    // NO execution row, NO consume — capability stays issued-but-unconsumed.
    const capRows = await db().select().from(capabilities).where(eq(capabilities.id, d.capability!.capability_id));
    expect(capRows[0]?.status).toBe("issued");
    const execRows = await db().select().from(executions).where(eq(executions.capabilityId, d.capability!.capability_id));
    expect(execRows).toHaveLength(0);
  }, 30000);

  it("agent-origin purchase never settles: executor discovery arm returns payment_required again", async () => {
    const taskId = await newTask("agent-origin purchase", 50);
    const result = await call(taskId, "scanner.scan", { target: "acme/backend#421", purchase: true, price_usd_cents: 33 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const d = result.data;
    expect(d.decision).toBe("allow");
    expect(d.payment_required).not.toBeNull(); // discovery response, not a settlement
    expect(d.payment).toBeNull();
    const events = await taskEvents(taskId);
    const types = events.map((e) => e.eventType);
    expect(types).toContain("service.discovered");
    expect(types.some((t) => t.startsWith("payment."))).toBe(false);
  }, 30000);

  it("CHALLENGE_UNAVAILABLE: unreachable service → payment.failed, capability revoked, no execution", async () => {
    const taskId = await newTask("unreachable service purchase", 50);
    try {
      await db().update(tools).set({ executorConfig: { endpoint: "http://127.0.0.1:9/x402-unreachable" } })
        .where(eq(tools.tenantId, tenantId));
      const result = await call(taskId, "scanner.scan", { target: "acme/backend#421", purchase: true, price_usd_cents: 33 }, "payment_discovery");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.payment).toEqual({
        payment_id: expect.any(String),
        status: "failed",
        settlement_ref: null,
        error_code: "CHALLENGE_UNAVAILABLE",
      });
      expect(result.data.execution).toBeNull();
      const capRow = await db().select().from(capabilities).where(eq(capabilities.id, result.data.capability!.capability_id));
      expect(capRow[0]?.status).toBe("revoked");
      const events = await taskEvents(taskId);
      const failed = events.find((e) => e.eventType === "payment.failed");
      expect(failed).toBeDefined();
      expect((failed!.payload as Record<string, unknown>).error_code).toBe("CHALLENGE_UNAVAILABLE");
    } finally {
      await db().update(tools).set({ executorConfig: { endpoint: scannerUrl } })
        .where(eq(tools.tenantId, tenantId));
    }
  }, 30000);

  it("PRICE_MISMATCH: agent claims a lower price than the service's real price → payment.failed, revoked", async () => {
    const taskId = await newTask("price mismatch purchase", 50);
    const result = await call(taskId, "scanner.scan", { target: "acme/backend#421", purchase: true, price_usd_cents: 20 }, "payment_discovery");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.decision).toBe("allow");
    expect(result.data.capability!.budget_usd_cents).toBe(20);
    expect(result.data.payment).toEqual({
      payment_id: expect.any(String),
      status: "failed",
      settlement_ref: null,
      error_code: "PRICE_MISMATCH",
    });
    expect(result.data.execution).toBeNull();
    const capRow = await db().select().from(capabilities).where(eq(capabilities.id, result.data.capability!.capability_id));
    expect(capRow[0]?.status).toBe("revoked");
    const events = await taskEvents(taskId);
    const failed = events.find((e) => e.eventType === "payment.failed");
    expect((failed!.payload as Record<string, unknown>).error_code).toBe("PRICE_MISMATCH");
  }, 30000);

  it("AC4 canary: operator key material appears in no response, event payload, or log line", async () => {
    const keyValue = config().HEDERA_OPERATOR_KEY;
    if (!keyValue) {
      // Nothing to canary for without operator env — nothing is ever loaded.
      return;
    }
    const keyMaterial = [keyValue, keyValue.replace(/^0x/i, "")];
    const lines: string[] = [];
    const origWarn = console.warn;
    const origError = console.error;
    const origLog = console.log;
    const capture = (...args: unknown[]) => {
      lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    };
    console.warn = capture;
    console.error = capture;
    console.log = capture;
    try {
      // The loudest logger first: an unpaid POST under DEV BYPASS warns loudly.
      process.env.X402_DEV_BYPASS = "1";
      const bypass = await scannerPOST(
        new Request("http://localhost/api/services/scanner/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target: "acme/backend#421" }),
        }),
      );
      expect(bypass.status).toBe(200);
      delete process.env.X402_DEV_BYPASS;

      const taskId = await newTask("canary purchase", 50);
      const result = await call(taskId, "scanner.scan", { target: "acme/backend#421", purchase: true, price_usd_cents: 33 }, "payment_discovery");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const serialized = JSON.stringify(result.data);
      for (const material of keyMaterial) expect(serialized).not.toContain(material);
      const events = await taskEvents(taskId);
      for (const event of events) {
        const payload = JSON.stringify(event.payload);
        for (const material of keyMaterial) expect(payload).not.toContain(material);
      }
      const nets = await db().select().from(networkEvents).where(eq(networkEvents.agentPseudonym, pseudonymFor(AGENT_KEY)));
      for (const net of nets) {
        const row = JSON.stringify(net);
        for (const material of keyMaterial) expect(row).not.toContain(material);
      }
      expect(lines.length).toBeGreaterThan(0); // the DEV BYPASS warning was captured
      for (const line of lines) {
        for (const material of keyMaterial) expect(line).not.toContain(material);
      }
    } finally {
      console.warn = origWarn;
      console.error = origError;
      console.log = origLog;
      delete process.env.X402_DEV_BYPASS;
    }
  }, 30000);
});
