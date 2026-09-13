"use client";

// Frontend-only demo mapping for the network topology v2 surface.
// Regions are a deterministic synthetic assignment from the agent pseudonym
// (the network_events table carries no geography); services are a fixed demo
// set derived from the swarm's real tool calls + integration points. Nothing
// here touches the gateway pipeline, schema, or projection — it only reads
// the public NetworkEvent shape. All labels are sanitized (event type +
// outcome); prompts, arguments, and resources never reach this surface.

export interface Region {
  id: string;
  label: string;
}

export const REGIONS: Region[] = [
  { id: "global", label: "GLOBAL" },
  { id: "ap-sea-1", label: "AP-SEA-1" },
  { id: "eu-west-1", label: "EU-WEST-1" },
  { id: "us-east-1", label: "US-EAST-1" },
  { id: "ap-ne-1", label: "AP-NE-1" },
];

const GEO_IDS = REGIONS.filter((r) => r.id !== "global").map((r) => r.id);

// Stable 32-bit hash of the pseudonym hex — deterministic across renders.
function hashPseudonym(pseudonym: string): number {
  let h = 2166136261;
  for (let i = 0; i < pseudonym.length; i += 1) {
    h ^= pseudonym.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function regionFor(pseudonym: string): string {
  if (!pseudonym) return GEO_IDS[0];
  return GEO_IDS[hashPseudonym(pseudonym) % GEO_IDS.length];
}

export function inRegion(pseudonym: string, region: string): boolean {
  return region === "global" || regionFor(pseudonym) === region;
}

export interface ServiceNode {
  id: string;
  label: string;
  hint: string;
}

// Fixed demo service set: the executors / trust primitives agents actually
// touch through the gateway (swarm tools + integration points).
export const SERVICES: ServiceNode[] = [
  { id: "github-mcp", label: "GITHUB-MCP", hint: "repos · prs · files" },
  { id: "scanner-x402", label: "SCANNER-x402", hint: "paid scan · hedera" },
  { id: "deploy-adapter", label: "DEPLOY-ADPTR", hint: "production deploys" },
  { id: "ledger-approval", label: "LEDGER-APPR", hint: "hardware approvals" },
  { id: "graph-context", label: "GRAPH-CTX", hint: "identity · reputation" },
  { id: "task-bus", label: "TASK-BUS", hint: "task lifecycle" },
];

const CATEGORY_SERVICE: Record<string, string> = {
  coding: "github-mcp",
  deploy: "deploy-adapter",
  security: "scanner-x402",
  control: "task-bus",
};

// Route a public network event to the service it is "about". Gateway-internal
// legs (intent / evaluation / authorization) resolve via the agent's tool
// category so the onward path stays meaningful; payment / approval /
// discovery have a natural home regardless of category.
export function serviceFor(event: {
  action_class: string;
  agent_category: string;
}): string {
  switch (event.action_class) {
    case "payment":
      return "scanner-x402";
    case "approval":
      return "ledger-approval";
    case "discovery":
      return "graph-context";
    case "task":
      return "task-bus";
    case "execution":
    case "intent":
    case "evaluation":
    case "authorization":
    default:
      return CATEGORY_SERVICE[event.agent_category] ?? "github-mcp";
  }
}

// Short sanitized pulse label: "<event short> → <outcome>".
export function pulseLabel(event: { event_type: string; outcome: string }): string {
  const short = event.event_type.includes(".")
    ? event.event_type.split(".").slice(1).join(".")
    : event.event_type;
  return `${short} → ${event.outcome}`;
}
