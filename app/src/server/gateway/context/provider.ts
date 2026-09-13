import { eq } from "drizzle-orm";
import { config } from "../../config";
import { db } from "../../db/client";
import { agents } from "../../db/schema";
import type { Facts } from "../../domain";
import { GraphContextProvider } from "./graphProvider";
import { baseFacts, type ContextProvider, type FactsCtx, type FactsIntentRef } from "./base";

export type { ContextProvider, FactsCtx, FactsIntentRef } from "./base";
export { baseFacts } from "./base";

export class StaticContextProvider implements ContextProvider {
  async getFacts(intent: FactsIntentRef, ctx: FactsCtx): Promise<Facts> {
    return baseFacts(intent, ctx, 0.95); // static reputation: default until the Graph supplies one
  }
}

// plan-07 selection, extended plan-14: AGENT0_SUBGRAPH_URL *or*
// THEGRAPH_API_KEY engages the graph path (the client defaults to the Base
// deployment off the key). Agent without identity, or neither configured →
// StaticContextProvider (0.95). No other changes to plan-02's pipeline.
export class AutoContextProvider implements ContextProvider {
  async getFacts(intent: FactsIntentRef, ctx: FactsCtx): Promise<Facts> {
    const [agent] = await db().select().from(agents).where(eq(agents.id, ctx.agentId));
    if (agent?.erc8004Identity != null && (config().AGENT0_SUBGRAPH_URL || config().THEGRAPH_API_KEY)) {
      return new GraphContextProvider().getFacts(intent, ctx);
    }
    return new StaticContextProvider().getFacts(intent, ctx);
  }
}

let active: ContextProvider = new AutoContextProvider();

export function setContextProvider(provider: ContextProvider): void {
  active = provider;
}

export function getContextProvider(): ContextProvider {
  return active;
}
