// plan-16 HCS anchor tests — throwaway tenant test-plan-16-anchors.
// Pure helper tests (format, determinism, byte-identity) plus integration:
// mocked submit fires per allowlisted event with exact fingerprint bytes,
// failure never blocks or throws, absent topic disables without throwing,
// and the trace API derives the identical fingerprint.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../src/server/db/client";
import {
  agents, approvals, auditEvents, capabilities, decisions, executions,
  intents, networkEvents, payments, policies, tasks, tenants, tools,
} from "../src/server/db/schema";
import { runToolCall } from "../src/server/gateway/orchestrator";import { seed } from "../src/server/demo/seed";
import { GET as traceGET } from "../src/app/api/audit/trace/[taskId]/route";
import {
  ANCHORED_TYPES,
  anchorEvent,
  anchorTopicId,
  canonicalEnvelope,
  fingerprint,
  flushAnchors,
  resetAnchorsForTests,
  setAnchorSubmitter,
  topicUrl,
} from "../src/server/anchors/hcs";

vi.hoisted(() => {
  process.env.DEMO_TENANT_SLUG = "test-plan-16-anchors";
});

const TENANT = "test-plan-16-anchors";
const HEX64 = /^[0-9a-f]{64}$/;

let tenantId = "";
let agentId = "";
let taskId = "";
const submitted: string[] = [];

async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
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
  delete process.env.HCS_TOPIC_ID;
  resetAnchorsForTests();
  await seed();
  const [tenant] = await db().select().from(tenants).where(eq(tenants.slug, TENANT));
  tenantId = tenant.id;
  const [agent] = await db()
    .select()
    .from(agents)
    .where(and(eq(agents.tenantId, tenantId), eq(agents.agentKey, "agent:8472")));
  agentId = agent.id;
  const [task] = await db()
    .insert(tasks)
    .values({ tenantId, agentId, title: "anchors test task", budgetUsdCents: 50, status: "open" })
    .returning();
  taskId = task.id;
}, 120000);

afterAll(async () => {
  resetAnchorsForTests();
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
    await db().delete(tenants).where(eq(tenants.id, t.id));
  }
  const pseudo = createHash("sha256").update("agent:8472|cubic-network-v1").digest("hex").slice(0, 16);
  await db().delete(networkEvents).where(eq(networkEvents.agentPseudonym, pseudo));
  delete process.env.DEMO_TENANT_SLUG;
  delete (globalThis as Record<string, unknown>).__cubicConfig;
}, 120000);

describe("plan-16 fingerprint helpers (pure)", () => {
  it("fingerprint is 64-hex, deterministic, key-order insensitive", () => {
    const a = { event_type: "policy.evaluated", payload: { b: 1, a: [1, 2] } };
    const b = { event_type: "policy.evaluated", payload: { a: [1, 2], b: 1 } };
    expect(fingerprint(a)).toMatch(HEX64);
    expect(fingerprint(a)).toBe(fingerprint(b));
    expect(canonicalEnvelope(a)).toBe(canonicalEnvelope(b));
  });

  it("timestamps are excluded by design (DB clocks are not byte-stable)", () => {
    const a = { event_type: "task.completed", occurred_at: "2026-09-13T10:00:00.000Z", payload: { task_id: "x" } };
    const b = { event_type: "task.completed", occurred_at: "2026-09-13T10:00:00.123Z", payload: { task_id: "x" } };
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  it("topic helpers: absent → null, URL shape is the hashscan topic link", () => {
    expect(anchorTopicId()).toBeNull();
    expect(topicUrl("0.0.12345", "testnet")).toBe("https://hashscan.io/testnet/topic/0.0.12345");
  });
});

describe("plan-16 anchor hook", () => {
  it("absent topic → anchor-disabled (warn once), never throws", async () => {
    await withEnv({ HCS_TOPIC_ID: undefined }, async () => {
      resetAnchorsForTests();
      setAnchorSubmitter({ submit: async () => { throw new Error("must not be called"); } });
      expect(() =>
        anchorEvent({ event_type: "policy.evaluated", payload: { decision: "allow" } }),
      ).not.toThrow();
      await flushAnchors();
      setAnchorSubmitter(null);
    });
  });

  it("mocked submit fires per allowlisted event with exact fingerprint bytes", async () => {
    await withEnv({ HCS_TOPIC_ID: "0.0.999999" }, async () => {
      resetAnchorsForTests();
      submitted.length = 0;
      setAnchorSubmitter({ submit: async (fp: string) => { submitted.push(fp); return "0"; } });

      const allowlisted = {
        event_type: "policy.evaluated",
        payload: { intent_id: "11111111-1111-4111-8111-111111111111", decision: "allow" },
      };
      anchorEvent(allowlisted);
      anchorEvent({ event_type: "intent.created", payload: {} });
      await flushAnchors();
      expect(submitted).toEqual([fingerprint(allowlisted)]);
      setAnchorSubmitter(null);
    });
  });

  it("submit failure never blocks or throws", async () => {
    await withEnv({ HCS_TOPIC_ID: "0.0.999999" }, async () => {
      resetAnchorsForTests();
      setAnchorSubmitter({
        submit: async () => { throw new Error("mirror unreachable"); },
      });
      expect(() =>
        anchorEvent({ event_type: "task.completed", payload: { task_id: taskId } }),
      ).not.toThrow();
      await flushAnchors();
      setAnchorSubmitter(null);
    });
  });

  it("end-to-end: a real tool call emits allowlisted events that anchor with display-identical bytes", async () => {
    await withEnv({ HCS_TOPIC_ID: "0.0.999999" }, async () => {
      resetAnchorsForTests();
      submitted.length = 0;
      setAnchorSubmitter({ submit: async (fp: string) => { submitted.push(fp); return "0"; } });

      const r = await runToolCall({
        task_id: taskId,
        agent_key: "agent:8472",
        tool: "github.get_pull_request",
        arguments: { repo: "acme/backend", pr: 421 },
      });
      expect(r.ok).toBe(true);
      await flushAnchors();
      // policy.evaluated + capability.issued are allowlisted; intent.created is not.
      expect(submitted.length).toBeGreaterThanOrEqual(2);

      const traceRes = await traceGET(new Request("http://test/audit/trace"), {
        params: Promise.resolve({ taskId }),
      });
      const body = (await traceRes.json()) as {
        ok: boolean;
        data: { events: Array<{ event_type: string; payload: Record<string, unknown>; anchor: { fingerprint: string; topic_id: string | null } }> };
      };
      expect(body.ok).toBe(true);
      for (const event of body.data.events) {
        expect(event.anchor.fingerprint).toMatch(HEX64);
        expect(event.anchor.topic_id).toBe("0.0.999999");
        if (ANCHORED_TYPES.has(event.event_type)) {
          // Display bytes are submit-identical: the same fingerprint the hook
          // submitted for this event content appears in the submitted batch.
          expect(submitted).toContain(event.anchor.fingerprint);
        }
      }
      setAnchorSubmitter(null);
    });
  }, 120000);

  it("trace anchor without topic → fingerprint present, topic_id null", async () => {
    await withEnv({ HCS_TOPIC_ID: undefined }, async () => {
      const traceRes = await traceGET(new Request("http://test/audit/trace"), {
        params: Promise.resolve({ taskId }),
      });
      const body = (await traceRes.json()) as {
        ok: boolean;
        data: { events: Array<{ anchor: { fingerprint: string; topic_id: string | null } }> };
      };
      expect(body.ok).toBe(true);
      expect(body.data.events.length).toBeGreaterThan(0);
      for (const event of body.data.events) {
        expect(event.anchor.fingerprint).toMatch(HEX64);
        expect(event.anchor.topic_id).toBeNull();
      }
    });
  }, 60000);
});
