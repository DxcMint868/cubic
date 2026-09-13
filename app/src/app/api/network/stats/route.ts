import { and, count, eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { networkEvents } from "@/server/db/schema";

export const dynamic = "force-dynamic";

// plan-08 EXACT — aggregate counters over network_events:
// {ok:true, data:{agents_observed, intents_evaluated, allowed, denied,
// escalated, payments_completed}}.
export async function GET() {
  try {
    const [[observed], [evaluated], [allowed], [denied], [escalated], [paid]] = await Promise.all([
      db()
        .select({ value: sql<number>`count(distinct ${networkEvents.agentPseudonym})` })
        .from(networkEvents),
      db()
        .select({ value: count() })
        .from(networkEvents)
        .where(eq(networkEvents.eventType, "policy.evaluated")),
      db()
        .select({ value: count() })
        .from(networkEvents)
        .where(and(eq(networkEvents.actionClass, "evaluation"), eq(networkEvents.outcome, "allow"))),
      db()
        .select({ value: count() })
        .from(networkEvents)
        .where(and(eq(networkEvents.actionClass, "evaluation"), eq(networkEvents.outcome, "deny"))),
      db()
        .select({ value: count() })
        .from(networkEvents)
        .where(and(eq(networkEvents.actionClass, "evaluation"), eq(networkEvents.outcome, "escalate"))),
      db()
        .select({ value: count() })
        .from(networkEvents)
        .where(and(eq(networkEvents.actionClass, "payment"), eq(networkEvents.outcome, "completed"))),
    ]);

    return Response.json({
      ok: true,
      data: {
        agents_observed: Number(observed?.value ?? 0),
        intents_evaluated: Number(evaluated?.value ?? 0),
        allowed: Number(allowed?.value ?? 0),
        denied: Number(denied?.value ?? 0),
        escalated: Number(escalated?.value ?? 0),
        payments_completed: Number(paid?.value ?? 0),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      { ok: false, error: { code: "INTERNAL", message } },
      { status: 500 },
    );
  }
}
