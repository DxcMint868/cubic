import { describe, expect, it } from "vitest";
import {
  REGIONS,
  SERVICES,
  inRegion,
  pulseLabel,
  regionFor,
  serviceFor,
} from "../src/components/network/topology";

describe("network topology mapping (frontend-only demo)", () => {
  it("assigns a stable region per pseudonym", () => {
    const a = regionFor("abc123def456");
    expect(REGIONS.some((r) => r.id === a)).toBe(true);
    expect(regionFor("abc123def456")).toBe(a);
    expect(regionFor("")).toBe("ap-sea-1");
  });

  it("global matches everything, geo regions filter", () => {
    expect(inRegion("abc123def456", "global")).toBe(true);
    const r = regionFor("abc123def456");
    expect(inRegion("abc123def456", r)).toBe(true);
  });

  it("routes payment/approval/discovery/task to their natural service", () => {
    expect(serviceFor({ action_class: "payment", agent_category: "coding" })).toBe(
      "scanner-x402",
    );
    expect(serviceFor({ action_class: "approval", agent_category: "deploy" })).toBe(
      "ledger-approval",
    );
    expect(serviceFor({ action_class: "discovery", agent_category: "control" })).toBe(
      "graph-context",
    );
    expect(serviceFor({ action_class: "task", agent_category: "security" })).toBe("task-bus");
  });

  it("routes gateway-internal legs via the agent category", () => {
    expect(serviceFor({ action_class: "execution", agent_category: "coding" })).toBe(
      "github-mcp",
    );
    expect(serviceFor({ action_class: "execution", agent_category: "deploy" })).toBe(
      "deploy-adapter",
    );
    expect(serviceFor({ action_class: "intent", agent_category: "security" })).toBe(
      "scanner-x402",
    );
    expect(serviceFor({ action_class: "evaluation", agent_category: "control" })).toBe(
      "task-bus",
    );
    expect(serviceFor({ action_class: "authorization", agent_category: "unknown" })).toBe(
      "github-mcp",
    );
  });

  it("every routed service exists in the fixed service set", () => {
    const ids = new Set(SERVICES.map((s) => s.id));
    for (const action of ["intent", "evaluation", "authorization", "approval", "payment", "discovery", "execution", "task"]) {
      for (const cat of ["coding", "deploy", "security", "control"]) {
        expect(ids.has(serviceFor({ action_class: action, agent_category: cat }))).toBe(true);
      }
    }
  });

  it("builds short sanitized pulse labels", () => {
    expect(
      pulseLabel({ event_type: "tool.execution.completed", outcome: "succeeded" }),
    ).toBe("execution.completed → succeeded");
    expect(pulseLabel({ event_type: "policy.evaluated", outcome: "deny" })).toBe(
      "evaluated → deny",
    );
  });
});
