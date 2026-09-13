import { describe, expect, it } from "vitest";
import type { AuditEvent } from "@/lib/api";
import {
  deriveAgents,
  deriveApprovals,
  deriveApprovers,
  derivePolicies,
  deriveTasks,
  parseTs,
} from "@/components/console/derive";

function event(partial: Partial<AuditEvent> & Pick<AuditEvent, "id" | "event_type">): AuditEvent {
  return {
    tenant_id: "t1",
    task_id: "11111111-1111-4111-8111-111111111111",
    agent_id: "22222222-2222-4222-8222-222222222222",
    payload: {},
    created_at: "2026-09-11 17:00:00.000000+00",
    ...partial,
  };
}

describe("parseTs", () => {
  it("parses postgres-style timestamps with microsecond precision", () => {
    const parsed = parseTs("2026-09-11 17:26:48.258945+00");
    expect(parsed?.toISOString()).toBe("2026-09-11T17:26:48.258Z");
  });

  it("parses plain ISO timestamps", () => {
    expect(parseTs("2026-09-11T17:26:48.258Z")?.toISOString()).toBe(
      "2026-09-11T17:26:48.258Z",
    );
  });

  it("returns null for garbage", () => {
    expect(parseTs("not-a-date")).toBeNull();
  });
});

describe("deriveTasks", () => {
  it("keeps the newest event time regardless of input order", () => {
    const newest = event({
      id: 3,
      event_type: "tool.execution.completed",
      created_at: "2026-09-11 17:05:00.000000+00",
    });
    const oldest = event({
      id: 1,
      event_type: "intent.created",
      payload: { tool: "github.read_file" },
      created_at: "2026-09-11 17:00:00.000000+00",
    });
    const tasks = deriveTasks([newest, oldest]);
    expect(tasks[0].lastEventAt).toBe("2026-09-11 17:05:00.000000+00");
    expect(tasks[0].descriptor).toBe("github.read_file");
    expect(tasks[0].intents).toBe(1);
  });
});

describe("deriveAgents", () => {
  it("keeps the newest event time regardless of input order", () => {
    const agents = deriveAgents([
      event({ id: 9, event_type: "tool.execution.completed", created_at: "2026-09-11 17:09:00+00" }),
      event({ id: 2, event_type: "intent.created", created_at: "2026-09-11 17:02:00+00" }),
    ]);
    expect(agents[0].lastEventAt).toBe("2026-09-11 17:09:00+00");
  });
});

describe("derivePolicies", () => {
  it("keeps the newest evaluation time regardless of input order", () => {
    const policies = derivePolicies([
      event({
        id: 9,
        event_type: "policy.evaluated",
        payload: { matched_policy: "default-v1", matched_rule_id: "r1", decision: "allow" },
        created_at: "2026-09-11 17:09:00+00",
      }),
      event({
        id: 2,
        event_type: "policy.evaluated",
        payload: { matched_policy: "default-v1", matched_rule_id: "r1", decision: "allow" },
        created_at: "2026-09-11 17:02:00+00",
      }),
    ]);
    expect(policies[0].lastSeen).toBe("2026-09-11 17:09:00+00");
  });
});

describe("deriveApprovals", () => {
  it("keeps pending without a completion and records the provider on completion", () => {
    const decisionId = "33333333-3333-4333-8333-333333333333";
    const approvalId = "44444444-4444-4444-8444-444444444444";
    const { pending, resolved } = deriveApprovals([
      event({
        id: 20,
        event_type: "ledger.approval.completed",
        payload: { approval_id: approvalId, decision_id: decisionId, provider: "ledger", outcome: "approved" },
        created_at: "2026-09-11 17:20:00+00",
      }),
      event({
        id: 10,
        event_type: "ledger.approval.requested",
        payload: { approval_id: approvalId, decision_id: decisionId, provider: "dev", action: "deploy_production", resource: "acme/backend" },
        created_at: "2026-09-11 17:10:00+00",
      }),
    ]);
    expect(pending).toHaveLength(0);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].provider).toBe("ledger");
    expect(resolved[0].status).toBe("approved");
  });

  it("does not invent a dev provider when the requested event is missing", () => {    const { resolved } = deriveApprovals([
      event({
        id: 30,
        event_type: "ledger.approval.completed",
        payload: {
          approval_id: "55555555-5555-4555-8555-555555555555",
          decision_id: "66666666-6666-4666-8666-666666666666",
          provider: "ledger",
          outcome: "rejected",
        },
        created_at: "2026-09-11 17:30:00+00",
      }),
    ]);
    expect(resolved[0].provider).toBe("ledger");
  });
});

describe("deriveApprovers", () => {
  it("groups by wallet signer when signed, else by attribution string", () => {
    const rows = deriveApprovers([
      event({
        id: 1,
        event_type: "ledger.approval.completed",
        payload: { approval_id: "a", decision_id: "d", provider: "dev", outcome: "approved", resolved_by: "demo-operator", signer: "0xabc", signature: "0x123" },
        created_at: "2026-09-11 17:10:00+00",
      }),
      event({
        id: 2,
        event_type: "ledger.approval.completed",
        payload: { approval_id: "b", decision_id: "d", provider: "dev", outcome: "rejected", resolved_by: "demo-operator", signer: "0xabc", signature: "0x456" },
        created_at: "2026-09-11 17:20:00+00",
      }),
      event({
        id: 3,
        event_type: "ledger.approval.completed",
        payload: { approval_id: "c", decision_id: "d", provider: "dev", outcome: "rejected", resolved_by: "demo-operator" },
        created_at: "2026-09-11 17:30:00+00",
      }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe("demo-operator");
    expect(rows[0]).toMatchObject({ resolved: 1, approved: 0, rejected: 1, signed: 0 });
    expect(rows[1]).toMatchObject({ id: "0xabc", resolved: 2, approved: 1, rejected: 1, signed: 2 });
    expect(rows[1].address).toBe("0xabc");
  });

  it("seeds council members with 0/0 before they ever resolve", () => {
    const rows = deriveApprovers([], [
      { name: "treasury-council", members: ["0xAAA", "0xBBB"] },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: "0xaaa", resolved: 0, approved: 0, rejected: 0, councils: ["treasury-council"] });
  });

  it("ignores non-completion events", () => {
    expect(deriveApprovers([
      event({ id: 1, event_type: "ledger.approval.requested", payload: {} }),
    ])).toHaveLength(0);
  });
});
