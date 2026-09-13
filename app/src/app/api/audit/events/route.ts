import { and, desc, eq, lt } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { auditEvents } from "@/server/db/schema";
import { eventTypes } from "@/server/events/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const taskId = url.searchParams.get("task_id");
    const eventType = url.searchParams.get("event_type");
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
    if (taskId != null) {
      if (!z.string().uuid().safeParse(taskId).success) {
        return Response.json(
          { ok: false, error: { code: "INVALID_REQUEST", message: "task_id must be a uuid" } },
          { status: 400 },
        );
      }
      filters.push(eq(auditEvents.taskId, taskId));
    }
    if (eventType != null) {
      if (!(eventTypes as readonly string[]).includes(eventType)) {
        return Response.json(
          { ok: false, error: { code: "INVALID_REQUEST", message: `unknown event_type: ${eventType}` } },
          { status: 400 },
        );
      }
      filters.push(eq(auditEvents.eventType, eventType));
    }
    if (beforeRaw != null) {
      const before = Number.parseInt(beforeRaw, 10);
      if (!Number.isFinite(before) || before < 0) {
        return Response.json(
          { ok: false, error: { code: "INVALID_REQUEST", message: "before_id must be a non-negative integer" } },
          { status: 400 },
        );
      }
      filters.push(lt(auditEvents.id, before));
    }

    const rows = await db()
      .select()
      .from(auditEvents)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(auditEvents.id))
      .limit(limit);

    return Response.json({
      ok: true,
      data: {
        events: rows.map((row) => ({
          id: row.id,
          event_type: row.eventType,
          tenant_id: row.tenantId,
          task_id: row.taskId,
          agent_id: row.agentId,
          payload: row.payload,
          created_at: row.createdAt,
        })),
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
