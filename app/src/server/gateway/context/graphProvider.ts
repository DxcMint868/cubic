import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import { agents } from "../../db/schema";
import type { Facts } from "../../domain";
import { HttpAgent0Client, type Agent0Client, type AgentTrust } from "../../graph/agent0";
import { baseFacts, type ContextProvider, type FactsCtx, type FactsIntentRef } from "./base";

// plan-07 EXACT fixture map — demo-only identity, flagged demo. Real identities
// go over GraphQL; ONLY this fixture identity short-circuits (never networked).
const FIXTURE_TRUST: Record<string, AgentTrust> = {
  "fixture:low-rep": { identity: "fixture:low-rep", reputation: 0.50, validation: "unknown", capabilities: [], feedbackCount: 1 },
};

// plan-07 EXACT neutral fallback: 0.80 sits exactly AT default-v1's
// reputation-floor (min: 0.80, applies only when strictly below) — neutral
// passes by design, any real 0.79 from the subgraph escalates.
export const NEUTRAL_REPUTATION = 0.80;

export class GraphContextProvider implements ContextProvider {
  private readonly agent0: Agent0Client;

  constructor(agent0?: Agent0Client) {
    this.agent0 = agent0 ?? new HttpAgent0Client();
  }

  async getFacts(intent: FactsIntentRef, ctx: FactsCtx): Promise<Facts> {
    const [agent] = await db().select().from(agents).where(eq(agents.id, ctx.agentId));
    if (!agent) throw new Error(`context: agent row missing ${ctx.agentId}`);
    const identity = agent.erc8004Identity || null; // "" (degenerate row) behaves like null
    // Object.hasOwn: inherited keys ("__proto__", "constructor", …) on a DB-written
    // erc8004_identity must NOT resolve to a truthy fixture with undefined reputation.
    const fixture = identity && Object.hasOwn(FIXTURE_TRUST, identity) ? FIXTURE_TRUST[identity] : undefined;
    let trust: AgentTrust;
    if (fixture) {
      trust = fixture;
    } else {
      trust = await this.lookupWithFallback(identity ?? "");
    }
    return baseFacts(intent, ctx, trust.reputation);
  }

  // plan-07 EXACT fallback: any fetch/timeout/validation error → neutral 0.80 +
  // console.warn("graph-context-fallback", { identity }). Never throw into the pipeline.
  private async lookupWithFallback(identity: string): Promise<AgentTrust> {
    try {
      return await this.agent0.lookup(identity);
    } catch {
      console.warn("graph-context-fallback", { identity });
      return { identity, reputation: NEUTRAL_REPUTATION, validation: "unknown", capabilities: [], feedbackCount: 0 };
    }
  }
}
