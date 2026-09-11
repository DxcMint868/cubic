import { desc, lt } from "drizzle-orm";
import { db } from "@/server/db/client";
import { networkEvents } from "@/server/db/schema";
import { publicShape } from "@/server/events/projection";

export const dynamic = "force-dynamic";

// plan-08 EXACT — paged network_events newest-first:
// {ok:true, data:{events:[{id, event_type, agent_pseudonym, agent_category,
// action_class, outcome, risk_class, created_at}]}}.
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limitRaw = url.searchParams.get("limit");
    const beforeRaw = url.searchParams.get("before_id");

    const limitParsed = limitRaw == null ? 50 : Number.parseInt(limitRaw, 10);
    if (!Number.isFinite(limitParsed) || limitParsed < 1) {
      return Response.json(
        { ok: false, error: { code: "INVALID_REQUEST", message: "limit must be a positive integer" } },
        { status: 400 },
      );
    }
    const limit = Math.min(limitParsed, 200);

    const filters = [];
    if (beforeRaw != null) {
      const before = Number.parseInt(beforeRaw, 10);
      if (!Number.isFinite(before) || before < 0) {
        return Response.json(
          { ok: false, error: { code: "INVALID_REQUEST", message: "before_id must be a non-negative integer" } },
          { status: 400 },
        );
      }
      filters.push(lt(networkEvents.id, before));
    }

    const rows = await db()
      .select()
      .from(networkEvents)
      .where(filters.length ? filters[0] : undefined)
      .orderBy(desc(networkEvents.id))
      .limit(limit);

    return Response.json({
      ok: true,
      data: { events: rows.map((row) => publicShape(row)) },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      { ok: false, error: { code: "INTERNAL", message } },
      { status: 500 },
    );
  }
}
