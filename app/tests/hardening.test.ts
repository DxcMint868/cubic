import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { exec } from "node:child_process";
import * as http from "node:http";
import * as path from "node:path";
import { promisify } from "node:util";
import { and, asc, eq, inArray } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { db } from "../src/server/db/client";
import {
  agents, approvals, auditEvents, capabilities, councils, decisions, executions, intents,
  networkEvents, policies, tasks, tenants, tools,
} from "../src/server/db/schema";
import { pseudonymFor } from "../src/server/events/projection";
import { runToolCall } from "../src/server/gateway/orchestrator";
import { POST as resolvePOST } from "../src/app/api/approvals/[id]/resolve/route";
import { GET as traceGET } from "../src/app/api/audit/trace/[taskId]/route";
import { DevSecretProtector, getSecretProtector } from "../src/server/ledger/dev";
import { hashscanUrl, resolvedByOf } from "../src/components/console/TraceView";

// plan-12 sponsor-hardening suite: throwaway tenant test-plan-12. Never
// touches the demo tenant.
vi.hoisted(() => {
  process.env.DEMO_TENANT_SLUG = "test-plan-12";
  delete process.env.GITHUB_TOKEN;
  delete process.env.LEDGER_PROVIDER;
});

// TraceView's ChainEntry renders real KV/Stage logic from TraceView.tsx; only
// next/link (node-SSR-hostile) and the leaf ConsoleBits badges are stubbed.
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

const execAsync = promisify(exec);
const TENANT = "test-plan-12";
const AGENT_KEY = "agent:test-12";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let tenantId: string;
let agentId: string;

const TOOLS = [
  { name: "github.merge_pull_request", category: "coding", default_risk_class: "high", executor: "github", executor_config: {} },
];

const RULES = [
  { id: "deny-secret-resources", type: "resource_class", match: ["secret"], decision: "deny", reason: "secret_resource" },
  { id: "tool-allowlist", type: "tool_allowlist", tools: TOOLS.map((t) => t.name), decision: "deny", reason: "tool_not_allowed" },
  { id: "risk-approval", type: "risk_class", match: ["high", "critical"], decision: "escalate", reason: "risk_requires_approval" },
  { id: "default-allow", type: "default", decision: "allow", reason: "policy_default_allow" },
];

function call(taskId: string, tool: string, args: Record<string, unknown> = {}) {
  return runToolCall({ task_id: taskId, agent_key: AGENT_KEY, tool, arguments: args });
}

function resolve(approvalId: string, body: unknown) {
  return resolvePOST(
    new Request("http://test/api/approvals/x/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: approvalId }) },
  );
}

async function taskEvents(taskId: string) {
  return db().select().from(auditEvents).where(eq(auditEvents.taskId, taskId)).orderBy(asc(auditEvents.id));
}

async function trace(taskId: string) {
  return traceGET(new Request(`http://test/api/audit/trace/${taskId}`), {
    params: Promise.resolve({ taskId }),
  });
}

async function escalate(taskId: string): Promise<string> {
  const escalated = await call(taskId, "github.merge_pull_request", { repo: "acme/backend", pr: 421 });
  expect(escalated.ok).toBe(true);
  if (!escalated.ok) throw new Error("escalate failed");
  expect(escalated.data.decision).toBe("escalate");
  const approvalId = escalated.data.approval_id as string;
  expect(approvalId).toMatch(UUID_RE);
  return approvalId;
}

beforeAll(async () => {
  const [tenant] = await db()
    .insert(tenants)
    .values({ slug: TENANT, name: "plan-12 throwaway" })
    .onConflictDoUpdate({ target: tenants.slug, set: { name: "plan-12 throwaway" } })
    .returning();
  tenantId = tenant.id;
  const [agent] = await db()
    .insert(agents)
    .values({
      tenantId, agentKey: AGENT_KEY, name: "test-12", environment: "demo",
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
    { tenantId, name: "default-v1", version: 1, rules: RULES.map((r) => ({ ...r })) },
    // selectPolicy routes merge_pull_request to production-merge-v1 (plan-02).
    {
      tenantId, name: "production-merge-v1", version: 1, rules: [
        { id: "merge-only", type: "tool_allowlist", tools: ["github.merge_pull_request"], decision: "deny", reason: "tool_not_allowed" },
        { id: "merge-risk", type: "risk_class", match: ["high"], decision: "escalate", reason: "risk_requires_approval" },
        { id: "default-deny", type: "default", decision: "deny", reason: "policy_default_deny" },
      ],
    },
  ]);
}, 30000);

afterAll(async () => {
  const tagents = await db().select().from(agents).where(eq(agents.tenantId, tenantId));
  const aids = tagents.map((a) => a.id);
  const tintents = aids.length ? await db().select().from(intents).where(inArray(intents.agentId, aids)) : [];
  const iids = tintents.map((i) => i.id);
  const tdecs = iids.length ? await db().select().from(decisions).where(inArray(decisions.intentId, iids)) : [];
  const dids = tdecs.map((d) => d.id);
  const tcaps = dids.length ? await db().select().from(capabilities).where(inArray(capabilities.decisionId, dids)) : [];
  const cids = tcaps.map((c) => c.id);
  if (cids.length) await db().delete(executions).where(inArray(executions.capabilityId, cids));
  if (cids.length) await db().delete(capabilities).where(inArray(capabilities.id, cids));
  if (dids.length) await db().delete(approvals).where(inArray(approvals.decisionId, dids));
  if (dids.length) await db().delete(decisions).where(inArray(decisions.id, dids));
  if (iids.length) await db().delete(intents).where(inArray(intents.id, iids));
  await db().delete(auditEvents).where(eq(auditEvents.tenantId, tenantId));
  await db().delete(tasks).where(eq(tasks.tenantId, tenantId));
  await db().delete(agents).where(eq(agents.tenantId, tenantId));
  await db().delete(tools).where(eq(tools.tenantId, tenantId));
  await db().delete(policies).where(eq(policies.tenantId, tenantId));
  await db().delete(councils).where(eq(councils.tenantId, tenantId));
  await db().delete(tenants).where(eq(tenants.id, tenantId));
  await db().delete(networkEvents).where(eq(networkEvents.agentPseudonym, pseudonymFor(AGENT_KEY)));
  delete process.env.DEMO_TENANT_SLUG;
}, 30000);

describe("plan-12 DevSecretProtector", () => {
  it("round-trip: protect labels and discards, use reads the named env var", async () => {
    process.env.CUBIC_TEST_SECRET = "s3cr3t-value";
    try {
      const p = new DevSecretProtector();
      const ref = await p.protect("CUBIC_TEST_SECRET", "ignored-plaintext");
      expect(ref).toBe("dev:CUBIC_TEST_SECRET");
      expect(await p.use(ref)).toBe("s3cr3t-value");
      expect(await p.use("CUBIC_TEST_SECRET")).toBe("s3cr3t-value");
    } finally {
      delete process.env.CUBIC_TEST_SECRET;
    }
  });

  it("use throws on a missing env var (never returns empty)", async () => {
    delete process.env.CUBIC_TEST_MISSING;
    const p = new DevSecretProtector();
    await expect(p.use("CUBIC_TEST_MISSING")).rejects.toThrow("DevSecretProtector: CUBIC_TEST_MISSING is not set");
  });

  it("protect warns that the dev stand-in is NOT hardware-protected", async () => {
    const warnings: string[] = [];
    const orig = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
    try {
      const p = new DevSecretProtector();
      await p.protect("CUBIC_TEST_SECRET", "x");
      expect(warnings.some((w) => w.includes("CUBIC_TEST_SECRET is NOT hardware-protected — dev stand-in only"))).toBe(true);
    } finally {
      console.warn = orig;
    }
  });

  it("factory: dev backend by default with the backend warn; keyring under LEDGER_PROVIDER=ledger", async () => {
    // Fresh module registry so the factory's once-memo starts silent. Only
    // dynamic imports after this point see the fresh module identity.
    vi.resetModules();
    delete (globalThis as Record<string, unknown>).__cubicConfig;
    delete process.env.LEDGER_PROVIDER;
    const warnings: string[] = [];
    const orig = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
    try {
      const fresh = await import("../src/server/ledger/dev");
      const dev = fresh.getSecretProtector();
      // vi.resetModules gives dev.ts its own class identity — compare
      // against the fresh module's exports, not the static import.
      expect(dev).toBeInstanceOf(fresh.DevSecretProtector);
      expect(warnings.filter((w) => w.includes("[ledger] secret-protector backend: dev"))).toHaveLength(1);
      // Memo: a second call does not re-warn.
      fresh.getSecretProtector();
      expect(warnings.filter((w) => w.includes("[ledger] secret-protector backend: dev"))).toHaveLength(1);

      // Flip the backend: keyring under LEDGER_PROVIDER=ledger (config cache reset first).
      process.env.LEDGER_PROVIDER = "ledger";
      delete (globalThis as Record<string, unknown>).__cubicConfig;
      const ledger = fresh.getSecretProtector();
      const freshKeyring = await import("../src/server/ledger/keyring");
      expect(ledger).toBeInstanceOf(freshKeyring.LedgerKeyRingProvider);
      expect(warnings.some((w) => w.includes("[ledger] secret-protector backend: keyring"))).toBe(true);
      expect(warnings.some((w) => w.includes("secret-protector backend: keyring") && w.includes("NOT hardware-protected"))).toBe(false);
    } finally {
      console.warn = orig;
      delete process.env.LEDGER_PROVIDER;
      delete (globalThis as Record<string, unknown>).__cubicConfig;
    }
  });

  it("the operator-key read resolves through the protector seam", async () => {
    // Dummy env so the seam is exercised everywhere (no real key needed —
    // the protector just reads the named var).
    process.env.HEDERA_OPERATOR_KEY = "seam-probe-dummy";
    try {
      const value = await getSecretProtector().use("HEDERA_OPERATOR_KEY");
      expect(value).toBe("seam-probe-dummy");
    } finally {
      delete process.env.HEDERA_OPERATOR_KEY;
    }
  });
});

describe("plan-12 resolved_by (event-sourced approver identity)", () => {
  it("explicit resolved_by lands in the approval-completed event and the trace", async () => {
    const taskId = await db()
      .insert(tasks)
      .values({ tenantId, agentId, title: "plan-12 explicit resolver", budgetUsdCents: 50, status: "open" })
      .returning()
      .then((rows) => rows[0].id);
    const approvalId = await escalate(taskId);
    const res = await resolve(approvalId, { outcome: "approved", resolved_by: "alice" });
    expect(res.status).toBe(200);
    const events = await taskEvents(taskId);
    const completed = events.find((e) => e.eventType === "ledger.approval.completed");
    expect(completed?.payload).toMatchObject({ approval_id: approvalId, outcome: "approved", resolved_by: "alice" });

    // Approvals columns: frozen set + council/signatures (council multisig —
    // additive nullable columns; the identity still lives in the event log).
    const [row] = await db().select().from(approvals).where(eq(approvals.id, approvalId));
    expect(row).toBeDefined();
    expect(Object.keys(row!).sort()).toEqual([
      "completedAt", "council", "decisionId", "id", "provider", "providerRef", "requestedAt", "signatures", "status", "type",
    ]);

    const traceRes = await trace(taskId);
    expect(traceRes.status).toBe(200);
    const body = (await traceRes.json()) as {
      ok: boolean;
      data: { events: Array<{ event_type: string; payload: Record<string, unknown> }> };
    };
    expect(body.ok).toBe(true);
    expect(resolvedByOf(body.data.events, approvalId)).toBe("alice");
  }, 30000);

  it("omitted resolved_by defaults to demo-operator", async () => {
    const taskId = await db()
      .insert(tasks)
      .values({ tenantId, agentId, title: "plan-12 default resolver", budgetUsdCents: 50, status: "open" })
      .returning()
      .then((rows) => rows[0].id);
    const approvalId = await escalate(taskId);
    const res = await resolve(approvalId, { outcome: "approved" });
    expect(res.status).toBe(200);
    const events = await taskEvents(taskId);
    const completed = events.find((e) => e.eventType === "ledger.approval.completed");
    expect(completed?.payload).toMatchObject({ approval_id: approvalId, outcome: "approved", resolved_by: "demo-operator" });
  }, 30000);

  it("empty-string resolved_by is rejected (400), never silently defaulted", async () => {
    const res = await resolve(randomUuid(), { outcome: "approved", resolved_by: "" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("INVALID_REQUEST");
  });
});

function randomUuid(): string {
  return "11111111-1111-4111-8111-111111111111";
}

describe("plan-12 TraceView helpers", () => {
  it("resolvedByOf joins on approval_id and falls back to unknown", () => {
    const events = [
      { event_type: "intent.created", payload: { intent_id: "i1" } },
      { event_type: "ledger.approval.completed", payload: { approval_id: "a1", outcome: "approved", resolved_by: "demo-operator" } },
      { event_type: "ledger.approval.completed", payload: { approval_id: "a2", outcome: "approved" } },
    ];
    expect(resolvedByOf(events, "a1")).toBe("demo-operator");
    // Pre-change rows (no resolved_by field) render "unknown" — never blank.
    expect(resolvedByOf(events, "a2")).toBe("unknown");
    // No matching event at all (pending approval) — "unknown", never invented.
    expect(resolvedByOf(events, "a3")).toBe("unknown");
    expect(resolvedByOf([], "a1")).toBe("unknown");
  });

  it("hashscanUrl produces the exact testnet transaction URL in dash form", () => {
    expect(hashscanUrl("0.0.10481126@1757640000.123456789")).toBe(
      "https://hashscan.io/testnet/transaction/0.0.10481126-1757640000-123456789",
    );
    // A ref without a timestamp passes through as-is.
    expect(hashscanUrl("0.0.10481126")).toBe(
      "https://hashscan.io/testnet/transaction/0.0.10481126",
    );
  });
});

describe("plan-12 TraceView renders (SSR)", () => {
  const baseEntry = {
    intent: {
      id: "i1", tool: "github.merge_pull_request", resource: "acme/backend",
      arguments_redacted: null, risk_class: "high", origin: "agent",
      normalized: null, created_at: "2026-09-12T00:00:00Z",
    },
    decision: null,
    capability: {
      id: "c1", subject: "agent:8472", action: "merge_pull_request", resource: "acme/backend",
      constraints: {}, budget_usd_cents: null, expires_at: "2026-09-12T01:00:00Z",
      nonce: "n".repeat(64), policy_hash: "p".repeat(64), status: "issued",
    },
    payments: [{
      id: "pay1", service: "scanner", network: "hedera", amount_usd_cents: 25,
      status: "completed", x402_ref: "0.0.10481126@1757640000.123456789",
      created_at: "2026-09-12T00:00:00Z", settled_at: "2026-09-12T00:00:01Z",
    }],
    executions: [],
    approvals: [{
      id: "a1", type: "ledger", status: "approved", provider: "dev",
      provider_ref: null, requested_at: "2026-09-12T00:00:00Z", completed_at: "2026-09-12T00:00:02Z",
    }],
  };

  it("renders the capability promo line, RESOLVED BY, and the HashScan link", async () => {
    const { ChainEntry } = await import("@/components/console/TraceView");
    const html = renderToStaticMarkup(createElement(ChainEntry, {
      entry: baseEntry,
      index: 0,
      events: [{
        event_type: "ledger.approval.completed", occurred_at: "2026-09-12T00:00:02Z",
        payload: { approval_id: "a1", outcome: "approved", resolved_by: "demo-operator" },
      }],
    }));
    // Capability promo line above the untouched KV grid.
    expect(html).toContain("AGENT agent:8472 RECEIVED SCOPED CAPABILITY — merge_pull_request · acme/backend · EXPIRES");
    // Approver identity joined from the event log.
    expect(html).toContain("RESOLVED BY");
    expect(html).toContain("demo-operator");
    // Settlement ref is a HashScan link (testnet) in dash form.
    expect(html).toContain('href="https://hashscan.io/testnet/transaction/0.0.10481126-1757640000-123456789"');
  });

  it("pre-change rows (no resolved_by) render unknown; null ref renders plain text", async () => {
    const { ChainEntry } = await import("@/components/console/TraceView");
    const html = renderToStaticMarkup(createElement(ChainEntry, {
      entry: {
        ...baseEntry,
        payments: [{ ...baseEntry.payments[0], x402_ref: null }],
      },
      index: 0,
      events: [{
        event_type: "ledger.approval.completed", occurred_at: "2026-09-12T00:00:02Z",
        payload: { approval_id: "a1", outcome: "approved" },
      }],
    }));
    expect(html).toContain("RESOLVED BY");
    expect(html).toContain("unknown");
    expect(html).not.toContain("hashscan.io");
  });
});

describe("plan-12 demo preflight bypass-flag abort", () => {
  // The scripted agent runs main() on import, so the preflight is proven by
  // spawning the real script against a fake health server (satisfies the
  // earlier preflight checks; the script then either aborts on a flag or
  // proceeds past preflight and fails later at seed). Dummy operator env so
  // the run deterministically reaches the flag assert in any environment.
  const SCRIPT = path.resolve(import.meta.dirname, "../src/server/demo/agent.ts");
  const APP_ROOT = path.resolve(import.meta.dirname, "..");

  function fakeHealth(): Promise<{ url: string; close: () => void }> {
    const server = http.createServer((_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, data: { db: "up" } }));
    });
    return new Promise((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const port = (server.address() as { port: number }).port;
        resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
      });
    });
  }

  async function spawnAgent(baseUrl: string, extraEnv: Record<string, string>): Promise<{ code: number | undefined; stdout: string; stderr: string }> {
    const env = {
      ...process.env,
      BASE_URL: baseUrl,
      HEDERA_OPERATOR_ID: "0.0.0",
      HEDERA_OPERATOR_KEY: "preflight-probe-dummy",
      ...extraEnv,
    };
    try {
      const { stdout, stderr } = await execAsync(`npx tsx ${SCRIPT}`, { env, cwd: APP_ROOT, timeout: 60000 });
      return { code: 0, stdout, stderr };
    } catch (err) {
      const e = err as { code?: number; stdout?: string; stderr?: string };
      return { code: e.code, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
    }
  }

  it("aborts on X402_DEV_BYPASS=1 (env override restored after)", async () => {
    const health = await fakeHealth();
    try {
      const { code, stderr } = await spawnAgent(health.url, { X402_DEV_BYPASS: "1" });
      expect(code).not.toBe(0);
      expect(stderr).toContain('preflight: X402_DEV_BYPASS must be unset or "0" for a real take');
    } finally {
      health.close();
    }
  }, 90000);

  it("aborts on X402_SIMULATE_FAILURE=1", async () => {
    const health = await fakeHealth();
    try {
      const { code, stderr } = await spawnAgent(health.url, { X402_SIMULATE_FAILURE: "1" });
      expect(code).not.toBe(0);
      expect(stderr).toContain('preflight: X402_SIMULATE_FAILURE must be unset or "0" for a real take');
    } finally {
      health.close();
    }
  }, 90000);

  it('"0" is accepted — the script gets past preflight (positive signal)', async () => {
    const health = await fakeHealth();
    try {
      const { code, stdout } = await spawnAgent(health.url, { X402_DEV_BYPASS: "0", X402_SIMULATE_FAILURE: "0" });
      expect(code).not.toBe(0); // fails later (fake server has no demo/seed)
      // Positive signal: the preflight confirmation line only prints after
      // the flag assert passes — proves the run cleared preflight.
      expect(stdout).toContain("bypass flags clear");
    } finally {
      health.close();
    }
  }, 90000);
});
