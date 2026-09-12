import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { asc, eq, inArray } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { db } from "../src/server/db/client";
import {
  agents, auditEvents, capabilities, decisions, executions, intents,
  networkEvents, payments, policies, tasks, tenants, tools,
} from "../src/server/db/schema";
import { pseudonymFor } from "../src/server/events/projection";
import { runToolCall } from "../src/server/gateway/orchestrator";
import { setPaymentProvider } from "../src/server/payments/x402";
import { HederaX402Provider } from "../src/server/payments/x402";
import { POST as scannerPOST } from "../src/app/api/services/scanner/scan/route";
import { GET as traceGET } from "../src/app/api/audit/trace/[taskId]/route";
import { ledgerBootGate } from "../src/server/ledger/boot-gate";
import { redactMeta, redactText, SECRET_KEY_RE } from "../src/server/logging";
import { registerExecutor, clearRegisteredExecutors } from "../src/server/executors/registry";
import { ChainEntry } from "@/components/console/TraceView";

// plan-13 council-hardening suite: throwaway tenant test-plan-13. Never
// touches the demo tenant. X402_SIMULATE_FAILURE=1 gives the real payment
// provider a deterministic failure for the revoke-path test.
vi.hoisted(() => {
  process.env.DEMO_TENANT_SLUG = "test-plan-13";
  process.env.X402_SCANNER_PRICE_CENTS = "29";
  process.env.X402_SIMULATE_FAILURE = "1";
  delete process.env.LEDGER_PROVIDER;
  delete process.env.LANGSMITH_API_KEY; // keep the reasoning path deterministic
});

// TraceView's ChainEntry renders real KV/Stage logic; only node-SSR-hostile
// next/link and the leaf ConsoleBits badges are stubbed (Tag must pass its
// children through so the CLIENT tag is visible).
vi.mock("next/link", () => ({
  default: (props: { href?: string; children?: unknown }) =>
    createElement("a", { href: props.href }, props.children as never),
}));
vi.mock("@/components/ConsoleBits", () => ({
  DecisionTag: (p: { d: string }) => createElement("span", null, p.d),
  ProviderBadge: (p: { provider: string }) => createElement("span", null, p.provider),
  Tag: (p: { children?: unknown }) => createElement("span", null, p.children as never),
  Skeleton: () => null,
  EmptyState: () => null,
  ErrorWindow: () => null,
}));

// langsmith SDK mocks for the server-minted write-side test (file-scoped —
// the real SDK path stays covered by treasury.test's live skipIf test).
vi.mock("langsmith/traceable", () => ({
  traceable: (fn: (snapshot: unknown) => unknown) => fn,
  getCurrentRunTree: () => ({ id: "22222222-2222-4222-8222-222222222222" }),
}));
vi.mock("langsmith", () => ({
  Client: class {
    async readRun(): Promise<unknown> {
      if (process.env.LANGSMITH_FAIL_READ === "1") throw new Error("run not found (vitest)");
      return { id: "22222222-2222-4222-8222-222222222222" };
    }
    async shareRun(): Promise<string> {
      return "https://smith.langchain.com/public/x/r";
    }
  },
}));

const TENANT = "test-plan-13";
const AGENT_KEY = "agent:test-13";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FAKE_KEY_MATERIAL = "HEDERA_OPERATOR_KEY=0xdeadbeefcafef00d password=hunter2";
const FAKE_EXECUTOR_MATERIAL = "token=sk-live-ABC123 api_key=xyz999";

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
  const webRes = await scannerPOST(webReq);
  res.statusCode = webRes.status;
  for (const [key, value] of webRes.headers) res.setHeader(key, value);
  res.end(Buffer.from(await webRes.arrayBuffer()));
});

const TOOLS = [
  { name: "scanner.scan", category: "security", default_risk_class: "medium", executor: "scanner", executor_config: {} },
  { name: "fail13.tool", category: "coding", default_risk_class: "low", executor: "fail13", executor_config: {} },
];

const DEFAULT_RULES = [
  { id: "tool-allowlist", type: "tool_allowlist", tools: TOOLS.map((t) => t.name), decision: "deny", reason: "tool_not_allowed" },
  { id: "default-allow", type: "default", decision: "allow", reason: "policy_default_allow" },
];
const PAYMENT_RULES = [
  { id: "service-allowlist", type: "service_allowlist", services: ["scanner"], decision: "deny", reason: "service_not_approved" },
  { id: "budget", type: "budget", decision: "deny", reason: "budget_exceeded" },
  { id: "default-allow", type: "default", decision: "allow", reason: "policy_default_allow" },
];

function resetConfig(): void {
  delete (globalThis as { __cubicConfig?: unknown }).__cubicConfig;
}

function call(taskId: string, tool: string, args: Record<string, unknown>, origin?: "agent" | "payment_discovery") {
  return runToolCall({
    task_id: taskId, agent_key: AGENT_KEY, tool, arguments: args,
    ...(origin ? { origin } : {}),
  } as never);
}

async function newTask(title: string, budgetUsdCents = 50): Promise<string> {
  const [row] = await db()
    .insert(tasks)
    .values({ tenantId, agentId, title, budgetUsdCents, status: "open" })
    .returning();
  return row.id;
}

async function taskEvents(taskId: string) {
  return db().select().from(auditEvents).where(eq(auditEvents.taskId, taskId)).orderBy(asc(auditEvents.id));
}

async function eventsOfType(taskId: string, type: string) {
  const events = await taskEvents(taskId);
  return events.filter((e) => e.eventType === type);
}

async function eventsPayload(taskId: string, type: string) {
  const events = await taskEvents(taskId);
  return events.filter((e) => e.eventType === type).map((e) => e.payload);
}

async function trace(taskId: string) {
  return traceGET(new Request(`http://test/api/audit/trace/${taskId}`), {
    params: Promise.resolve({ taskId }),
  });
}

function captureConsole(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  const capture = (...args: unknown[]) => {
    lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  };
  console.log = capture;
  console.warn = capture;
  console.error = capture;
  return { lines, restore: () => { console.log = orig.log; console.warn = orig.warn; console.error = orig.error; } };
}

beforeAll(async () => {
  const [tenant] = await db()
    .insert(tenants)
    .values({ slug: TENANT, name: "plan-13 throwaway" })
    .onConflictDoUpdate({ target: tenants.slug, set: { name: "plan-13 throwaway" } })
    .returning();
  tenantId = tenant.id;
  const [agent] = await db()
    .insert(agents)
    .values({
      tenantId, agentKey: AGENT_KEY, name: "test-13", environment: "demo",
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

  registerExecutor("fail13", {
    execute: async () => {
      throw new Error(`executor exploded with ${FAKE_EXECUTOR_MATERIAL}`);
    },
  });

  await new Promise<void>((resolve, reject) => {
    scannerServer.once("error", reject);
    scannerServer.listen(0, "127.0.0.1", () => resolve());
  });
  scannerUrl = `http://127.0.0.1:${(scannerServer.address() as AddressInfo).port}/api/services/scanner/scan`;
  await db().update(tools).set({ executorConfig: { endpoint: scannerUrl } })
    .where(eq(tools.tenantId, tenantId));
}, 30000);

afterAll(async () => {
  clearRegisteredExecutors();
  scannerServer.close();
  const tagents = await db().select().from(agents).where(eq(agents.tenantId, tenantId));
  const aids = tagents.map((a) => a.id);
  const tintents = aids.length ? await db().select().from(intents).where(inArray(intents.agentId, aids)) : [];
  const iids = tintents.map((i) => i.id);
  const tdecs = iids.length ? await db().select().from(decisions).where(inArray(decisions.intentId, iids)) : [];
  const dids = tdecs.map((d) => d.id);
  const tcaps = dids.length ? await db().select().from(capabilities).where(inArray(capabilities.decisionId, dids)) : [];
  const cids = tcaps.map((c) => c.id);
  if (cids.length) await db().delete(executions).where(inArray(executions.capabilityId, cids));
  if (cids.length) await db().delete(payments).where(inArray(payments.capabilityId, cids));
  if (cids.length) await db().delete(capabilities).where(inArray(capabilities.id, cids));
  if (dids.length) await db().delete(decisions).where(inArray(decisions.id, dids));
  if (iids.length) await db().delete(intents).where(inArray(intents.id, iids));
  await db().delete(auditEvents).where(eq(auditEvents.tenantId, tenantId));
  await db().delete(tasks).where(eq(tasks.tenantId, tenantId));
  await db().delete(agents).where(eq(agents.tenantId, tenantId));
  await db().delete(tools).where(eq(tools.tenantId, tenantId));
  await db().delete(policies).where(eq(policies.tenantId, tenantId));
  await db().delete(tenants).where(eq(tenants.id, tenantId));
  await db().delete(networkEvents).where(eq(networkEvents.agentPseudonym, pseudonymFor(AGENT_KEY)));
  delete process.env.DEMO_TENANT_SLUG;
  delete process.env.X402_SCANNER_PRICE_CENTS;
  delete process.env.X402_SIMULATE_FAILURE;
}, 30000);

describe("plan-13 shared redaction constant", () => {
  it("SECRET_KEY_RE covers camelCase holders and the snake_case spellings", () => {
    expect(SECRET_KEY_RE.test("operatorKey")).toBe(true);
    expect(SECRET_KEY_RE.test("apiKey")).toBe(true);
    expect(SECRET_KEY_RE.test("privateKey")).toBe(true);
    expect(SECRET_KEY_RE.test("HEDERA_OPERATOR_KEY")).toBe(true);
    expect(SECRET_KEY_RE.test("private-key")).toBe(true);
    expect(SECRET_KEY_RE.test("api-key")).toBe(true);
    expect(SECRET_KEY_RE.test("resource")).toBe(false);
  });

  it("redactMeta redacts camelCase secret keys and scrubs key-value pairs inside strings", () => {
    expect(redactMeta({ operatorKey: "0xabc", apiKey: "k", nested: { password: "p" } })).toEqual({
      operatorKey: "[REDACTED]", apiKey: "[REDACTED]", nested: { password: "[REDACTED]" },
    });
    expect(redactText(`boom with ${FAKE_KEY_MATERIAL}`)).toBe(
      "boom with HEDERA_OPERATOR_KEY=[REDACTED] password=[REDACTED]",
    );
    expect(redactText("no secrets here")).toBe("no secrets here");
  });
});

describe("plan-13 evil-twin canary (AC1)", () => {
  it("fake-secret executor throw reaches NO result.data, NO event, NO trace row — fixed enum + redacted logs only", async () => {
    const taskId = await newTask("evil-twin executor");
    const captured = captureConsole();
    try {
      const result = await call(taskId, "fail13.tool", { operatorKey: "0xNOTREAL999", note: "safe" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // agent surface: fixed enum, never the raw message, never key material
      expect(result.data.execution).toEqual({
        execution_id: expect.any(String),
        status: "failed",
        result_summary: null,
      });
      const serializedData = JSON.stringify(result.data);
      for (const leak of [FAKE_EXECUTOR_MATERIAL, "sk-live-ABC123", "xyz999"]) {
        expect(serializedData).not.toContain(leak);
      }
      // camelCase argument key is redacted at ingest (shared regex)
      const [intentRow] = await db().select().from(intents).where(eq(intents.id, result.data.intent_id));
      expect((intentRow.argumentsRedacted as Record<string, unknown>).operatorKey).toBe("[REDACTED]");
      expect((intentRow.argumentsRedacted as Record<string, unknown>).note).toBe("safe");

      // executions.error persists the fixed enum only
      const capId = result.data.capability!.capability_id;
      const events = await taskEvents(taskId);
      const failedExec = events.find((e) => e.eventType === "tool.execution.failed");
      expect(failedExec?.payload).toEqual({
        execution_id: expect.any(String),
        capability_id: capId,
        error_code: "EXECUTOR_ERROR",
      });
      for (const event of events) {
        const payload = JSON.stringify(event.payload);
        for (const leak of ["sk-live-ABC123", "xyz999"]) expect(payload).not.toContain(leak);
      }

      // trace route: the same fixed enum, no raw message
      const traceRes = await trace(taskId);
      expect(traceRes.status).toBe(200);
      const traceBody = JSON.stringify(await traceRes.json());
      for (const leak of ["sk-live-ABC123", "xyz999", "executor exploded"]) {
        expect(traceBody).not.toContain(leak);
      }

      // logs: redacting logger scrubs the key-value pairs server-side
      expect(captured.lines.length).toBeGreaterThan(0);
      for (const line of captured.lines) {
        expect(line).not.toContain("sk-live-ABC123");
        expect(line).not.toContain("xyz999");
      }
      expect(captured.lines.some((l) => l.includes("token=[REDACTED]"))).toBe(true);
    } finally {
      captured.restore();
    }
  }, 30000);

  it("purchase catch-all maps an unknown throw to the SETTLEMENT_ERROR enum before any surface", async () => {
    const taskId = await newTask("evil-twin purchase", 50);
    // A provider whose pay() THROWS with key-bearing raw text — the exact
    // class of unknown throw the tracer flagged.
    setPaymentProvider({
      pay: async () => {
        throw new Error(`provider exploded with ${FAKE_KEY_MATERIAL}`);
      },
      verifySettlement: async () => false,
    });
    const captured = captureConsole();
    try {
      const result = await call(
        taskId, "scanner.scan",
        { target: "acme/backend#421", purchase: true, price_usd_cents: 29 },
        "payment_discovery",
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.payment).toEqual({
        payment_id: expect.any(String),
        status: "failed",
        settlement_ref: null,
        error_code: "SETTLEMENT_ERROR",
      });
      const serializedData = JSON.stringify(result.data);
      for (const leak of [FAKE_KEY_MATERIAL, "0xdeadbeefcafef00d", "hunter2", "provider exploded"]) {
        expect(serializedData).not.toContain(leak);
      }

      const events = await taskEvents(taskId);
      const failed = events.find((e) => e.eventType === "payment.failed");
      expect(failed?.payload).toMatchObject({ error_code: "SETTLEMENT_ERROR" });
      for (const event of events) {
        const payload = JSON.stringify(event.payload);
        for (const leak of ["0xdeadbeefcafef00d", "hunter2"]) expect(payload).not.toContain(leak);
      }
      // the raw message IS logged server-side — but scrubbed by the shared redactor
      expect(captured.lines.some((l) => l.includes("purchase threw before completion"))).toBe(true);
      for (const line of captured.lines) {
        expect(line).not.toContain("0xdeadbeefcafef00d");
        expect(line).not.toContain("hunter2");
      }
    } finally {
      captured.restore();
    }
  }, 30000);
});

describe("plan-13 capability.revoked (AC2)", () => {
  it("failPayment revoke emits capability.revoked with the projection row; trace EVENTS tab shows it", async () => {
    const taskId = await newTask("simulated failure revoke");
    // The previous test installed a throwing custom provider — restore the
    // real one; X402_SIMULATE_FAILURE=1 (hoisted) makes it fail deterministically.
    setPaymentProvider(new HederaX402Provider());
    const result = await call(
      taskId, "scanner.scan",
      { target: "acme/backend#421", purchase: true, price_usd_cents: 29 },
      "payment_discovery",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.payment?.status).toBe("failed");
    expect(result.data.payment?.error_code).toBe("SIMULATED_SETTLEMENT_FAILURE");
    const capId = result.data.capability!.capability_id;

    const events = await taskEvents(taskId);
    const revoked = events.find((e) => e.eventType === "capability.revoked");
    expect(revoked?.payload).toEqual({ capability_id: capId, reason: "payment_failed" });

    // projection row: action_class authorization, outcome revoked
    const nets = await db().select().from(networkEvents).where(eq(networkEvents.agentPseudonym, pseudonymFor(AGENT_KEY)));
    const netRevoked = nets.find((n) => n.eventType === "capability.revoked");
    expect(netRevoked).toMatchObject({ actionClass: "authorization", outcome: "revoked" });

    // trace EVENTS tab (the trace route passes events verbatim)
    const traceRes = await trace(taskId);
    expect(traceRes.status).toBe(200);
    const body = (await traceRes.json()) as {
      ok: boolean;
      data: { events: Array<{ event_type: string; payload: Record<string, unknown> }> };
    };
    expect(body.data.events.some((e) => e.event_type === "capability.revoked")).toBe(true);

    // payment row failed; capability revoked
    const [paymentRow] = await db().select().from(payments).where(eq(payments.capabilityId, capId));
    expect(paymentRow.status).toBe("failed");
    const [capRow] = await db().select().from(capabilities).where(eq(capabilities.id, capId));
    expect(capRow.status).toBe("revoked");
  }, 30000);

  it("revokeCapability funnels: first revoke emits once, double revoke is a no-op (no second event)", async () => {
    const taskId = await newTask("revoke funnel");
    const result = await call(taskId, "scanner.scan", { target: "acme/backend#421" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The discovery round leaves the capability issued-but-unconsumed —
    // exactly the authority a stray revoke must kill, exactly once.
    const capId = result.data.capability!.capability_id;
    expect(await eventsOfType(taskId, "capability.revoked")).toHaveLength(0);
    const { revokeCapability } = await import("../src/server/capability/verify");
    expect(await revokeCapability(capId, "operator_panic")).toBe(true);
    expect(await eventsPayload(taskId, "capability.revoked")).toEqual([
      { capability_id: capId, reason: "operator_panic" },
    ]);
    expect(await revokeCapability(capId)).toBe(false); // not issued → no-op, no second event
    expect(await eventsOfType(taskId, "capability.revoked")).toHaveLength(1);
  }, 30000);
});

describe("plan-13 ledger boot-gate (AC3)", () => {
  function flipLedger(on: boolean): void {
    if (on) process.env.LEDGER_PROVIDER = "ledger";
    else delete process.env.LEDGER_PROVIDER;
    resetConfig();
  }

  it("LEDGER_PROVIDER=ledger without a provisioned ring aborts with the actionable message", async () => {
    flipLedger(true);
    const captured = captureConsole();
    try {
      const gate = await ledgerBootGate(async () => false);
      expect(gate.ok).toBe(false);
      // EXACT wording from plan step 3 — verbatim, nothing invented
      expect(gate.message).toBe("Key Ring not provisioned — run wallet-cli ring init on a device host");
      expect(captured.lines.some((l) => l.includes("Key Ring not provisioned"))).toBe(true);
    } finally {
      captured.restore();
      flipLedger(false);
    }
  });

  it("LEDGER_PROVIDER=ledger WITH a provisioned ring passes", async () => {
    flipLedger(true);
    try {
      const gate = await ledgerBootGate(async () => true);
      expect(gate.ok).toBe(true);
      expect(gate.message).toBe("");
    } finally {
      flipLedger(false);
    }
  });

  it("dev selection passes without consulting the ring probe (dev boot path untouched)", async () => {
    flipLedger(false);
    const gate = await ledgerBootGate(async () => {
      throw new Error("probe must not be consulted under dev selection");
    });
    expect(gate.ok).toBe(true);
  });
});

describe("plan-13 OPERATOR_KEY_NOT_PROTECTED (AC3)", () => {
  it("bare env-name ref under the ledger backend fails as OPERATOR_KEY_NOT_PROTECTED, cause server-side only", async () => {
    process.env.HEDERA_OPERATOR_ID = "0.0.9999999";
    process.env.HEDERA_OPERATOR_KEY = "seam-probe-dummy";
    process.env.LEDGER_PROVIDER = "ledger";
    delete process.env.X402_SIMULATE_FAILURE; // must not short-circuit before the protector read
    resetConfig();
    const captured = captureConsole();
    try {
      const provider = new HederaX402Provider();
      const out = await provider.pay({
        capability_id: randomUUID(),
        service: "scanner",
        amount_usd_cents: 29,
        challenge: {
          scheme: "exact", network: "hedera:testnet", amount: "1", payTo: "0.0.10482549",
          maxTimeoutSeconds: 300, asset: "0.0.0",
          extra: { feePayer: "0.0.1", price_usd_cents: 29 },
        },
      });
      expect(out).toEqual({ status: "failed", error_code: "OPERATOR_KEY_NOT_PROTECTED" });
      expect(captured.lines.some((l) => l.includes("not protected under this backend"))).toBe(true);
    } finally {
      captured.restore();
      delete process.env.HEDERA_OPERATOR_ID;
      delete process.env.HEDERA_OPERATOR_KEY;
      delete process.env.LEDGER_PROVIDER;
      process.env.X402_SIMULATE_FAILURE = "1";
      resetConfig();
    }
  });
});

describe("plan-13 reasoning_ref origin (AC4)", () => {
  // The server assist path actually writing "server-minted" — proven with a
  // mocked langsmith SDK (no real key needed): a captured run id that reads
  // back + shareRun resolves → the ref persists with origin "server-minted".
  it("traceAssistedNormalize persists origin 'server-minted' on the write side", async () => {
    process.env.LANGSMITH_API_KEY = "vitest-dummy-key";
    try {
      const { traceAssistedNormalize } = await import("../src/server/reasoning/langsmith");
      const base = {
        tool: "github.get_pull_request", action: "get_pull_request",
        resource: "acme/backend#421", risk_class: "low" as const, resource_class: "normal" as const,
        reasoning_ref: null,
      };
      const out = await traceAssistedNormalize({ tool: "github.get_pull_request", args: {}, taskId: "t" }, base);
      expect(out.reasoning_ref).toMatchObject({
        run_id: "22222222-2222-4222-8222-222222222222",
        share_url: "https://smith.langchain.com/public/x/r",
        origin: "server-minted",
      });
      // A failed read-back (honesty gate) → base untouched, null ref.
      process.env.LANGSMITH_FAIL_READ = "1";
      const failed = await traceAssistedNormalize({ tool: "github.get_pull_request", args: {}, taskId: "t" }, base);
      expect(failed.reasoning_ref).toBeNull();
    } finally {
      delete process.env.LANGSMITH_API_KEY;
      delete process.env.LANGSMITH_FAIL_READ;
    }
  });

  const refEntry = (origin?: string) => ({
    intent: {
      id: "i1", tool: "treasury.stake", resource: "treasury/lido",
      arguments_redacted: null, risk_class: "high", origin: "agent",
      normalized: {
        reasoning_ref: {
          run_id: "11111111-1111-4111-8111-111111111111",
          share_url: "https://smith.langchain.com/public/abc/r",
          ...(origin === undefined ? {} : { origin }),
        },
      },
      created_at: "2026-09-12T00:00:00Z",
    },
    decision: null,
    capability: null,
    payments: [],
    executions: [],
    approvals: [],
  });

  it("client-supplied ref renders the CLIENT tag", async () => {
    const html = renderToStaticMarkup(createElement(ChainEntry, {
      entry: refEntry("client-supplied") as never,
      index: 0,
      events: [],
    }));
    expect(html).toContain("CLIENT");
    expect(html).toContain("View AI Trace (LangSmith)");
  });

  it("server-minted ref renders WITHOUT the CLIENT tag", async () => {
    const html = renderToStaticMarkup(createElement(ChainEntry, {
      entry: refEntry("server-minted") as never,
      index: 0,
      events: [],
    }));
    expect(html).not.toContain("CLIENT");
    expect(html).toContain("View AI Trace (LangSmith)");
  });

  it("pre-plan-13 rows (no origin) render untagged, never as client", async () => {
    const html = renderToStaticMarkup(createElement(ChainEntry, {
      entry: refEntry(undefined) as never,
      index: 0,
      events: [],
    }));
    expect(html).not.toContain("CLIENT");
    expect(html).toContain("View AI Trace (LangSmith)");
  });
});
