import { z } from "zod";
import { config } from "../config";

// plan-07 EXACT interface — verbatim from .agents/plans/plan-07-graph-context.md step 1.
export interface AgentTrust {
  identity: string;
  reputation: number;                       // 0..1
  validation: "passed" | "failed" | "unknown";
  capabilities: string[];
}
export interface Agent0Client {
  lookup(erc8004Identity: string): Promise<AgentTrust>;   // GraphQL over HTTPS POST + zod-validate AgentTrust
}

// plan-07 EXACT in-memory cache: Map<identity, {value, expires}>, TTL 60s.
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { value: AgentTrust; expires: number }>();

const GRAPHQL_TIMEOUT_MS = 5_000;

// Default: Agent0 Base Mainnet deployment (agent0lab/subgraph). Hedera has no
// ERC-8004 contracts deployed, so reputation is read where it lives (Base)
// and enforced where we operate (Hedera testnet) — cross-chain trust context.
const DEFAULT_SUBGRAPH_ID = "43s9hQRurMGjuYnC1r2ZwS6xSQktbFyXMPMqGKUFJojb";

export function endpoint(): string | null {
  const explicit = config().AGENT0_SUBGRAPH_URL;
  if (explicit) return explicit;
  const key = config().THEGRAPH_API_KEY;
  if (!key) return null;
  return `https://gateway.thegraph.com/api/${key}/subgraphs/id/${DEFAULT_SUBGRAPH_ID}`;
}

// Query verified against the live Agent0 Subgraphs (ERC-8004) docs and the
// canonical schema (github.com/agent0lab/subgraph schema.graphql): agent carries
// registrationFile (capabilities: MCP tools + A2A skills), non-revoked feedback
// with `value` (score 0–100 per ERC-8004), and the latest validation with
// `status` (UPPERCASE enum PENDING|COMPLETED|EXPIRED) plus `response`
// (0–100 validation score; schema note: "0 means pending"). reputation +
// validation are the plan's must-have fields. Same schema on every deployment —
// only the endpoint URL changes.
export const AGENT0_QUERY = `
query GetAgentTrust($id: ID!) {
  agent(id: $id) {
    id
    registrationFile {
      mcpEndpoint
      mcpTools
      a2aSkills
    }
    feedback(where: { isRevoked: false }, first: 50, orderBy: createdAt, orderDirection: desc) {
      value
    }
    validations(first: 1, orderBy: createdAt, orderDirection: desc) {
      status
      response
    }
  }
}`;

// Subgraphs serialize BigDecimal/uint fields as JSON strings; accept plain
// decimal strings only ("" or "0x10"-style junk must fail → fallback 0.80).
// Negative scores are REAL on-chain data (penalty feedback, e.g. -50) —
// accept them; normalizeReputation clamps the mean into 0..1 below.
const scoreValue = z
  .union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/, "decimal string")])
  .transform((v) => (typeof v === "number" ? v : Number(v)))
  .refine((v) => Number.isFinite(v), "feedback.value must be a finite number");

const agentResponseSchema = z.object({
  data: z.object({
    agent: z
      .object({
        id: z.string(),
        registrationFile: z
          .object({
            mcpEndpoint: z.string().nullable().optional(),
            mcpTools: z.array(z.unknown()).nullable().optional(),
            a2aSkills: z.array(z.unknown()).nullable().optional(),
          })
          .nullable()
          .optional(),
        feedback: z.array(z.object({ value: scoreValue })).nullable().transform((v) => v ?? []),
        validations: z
          .array(z.object({ status: z.string(), response: z.number().nullable().optional() }))
          .nullable()
          .transform((v) => v ?? []),
      })
      .nullable(),
  }),
});

const agentTrustSchema = z.object({
  identity: z.string().min(1),
  reputation: z.number().min(0).max(1),
  validation: z.enum(["passed", "failed", "unknown"]),
  capabilities: z.array(z.string()),
});

// Feedback `value` is the ERC-8004 documented 0–100 score; normalize
// deterministically to 0..1 by mean/100 (values above the documented scale —
// e.g. decimal-shifted raw ints like 8500 = 85.00 — land proportionally and the
// clamp bounds outliers). No feedback at all → 0.50: an on-chain agent with
// zero feedback is unproven, not trusted (fail-closed; flagged in the report).
function normalizeReputation(values: number[]): number {
  if (values.length === 0) return 0.50;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  return Math.min(1, Math.max(0, mean / 100));
}

// Validation mapping per the canonical schema: only a COMPLETED validation has
// an outcome; `response` is the 0–100 validation score and "0 means pending"
// (→ unknown). PENDING/EXPIRED carry no outcome → unknown (absence of a
// validation is not evidence of a failed one). < 50 = weak validation.
function validationOutcome(
  status: string,
  response: number | null | undefined,
): AgentTrust["validation"] {
  if (status.toUpperCase() !== "COMPLETED" || response == null || response <= 0) return "unknown";
  return response >= 50 ? "passed" : "failed";
}

function toTrust(agent: {
  id: string;
  registrationFile?: {
    mcpEndpoint?: string | null;
    mcpTools?: unknown[] | null;
    a2aSkills?: unknown[] | null;
  } | null;
  feedback: { value: number }[];
  validations: { status: string; response?: number | null }[];
}): AgentTrust {
  const strings = (list: unknown[] | null | undefined) =>
    (list ?? []).filter((t): t is string => typeof t === "string");
  const latest = agent.validations[0];
  return {
    identity: agent.id,
    reputation: normalizeReputation(agent.feedback.map((f) => f.value)),
    validation: latest ? validationOutcome(latest.status, latest.response) : "unknown",
    capabilities: [
      ...strings(agent.registrationFile?.mcpTools),
      ...strings(agent.registrationFile?.a2aSkills),
    ],
  };
}

export class HttpAgent0Client implements Agent0Client {
  async lookup(erc8004Identity: string): Promise<AgentTrust> {
    const now = Date.now();
    const hit = cache.get(erc8004Identity);
    if (hit && hit.expires > now) return hit.value;

    const url = endpoint();
    if (!url) throw new Error("agent0: set AGENT0_SUBGRAPH_URL or THEGRAPH_API_KEY");

    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: AGENT0_QUERY, variables: { id: erc8004Identity } }),
      signal: AbortSignal.timeout(GRAPHQL_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`agent0: http ${res.status}`);
    const parsed = agentResponseSchema.parse(await res.json());
    if (!parsed.data.agent) throw new Error(`agent0: identity not indexed: ${erc8004Identity}`);
    const trust = agentTrustSchema.parse(toTrust(parsed.data.agent));
    cache.set(erc8004Identity, { value: trust, expires: now + CACHE_TTL_MS });
    return trust;
  }
}
