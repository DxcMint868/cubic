// HCS verification: recompute each trace event's fingerprint and check it
// against the actual topic messages on the Hedera mirror node (public REST,
// no key). This is the "AI did something stupid, prove the record" path: the
// UI shows per-event VERIFIED badges only when the exact bytes sit on-chain.
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { auditEvents, tasks, tenants } from "@/server/db/schema";
import { ANCHORED_TYPES, anchorTopicId, fingerprint, hederaNetwork } from "@/server/anchors/hcs";
import { config } from "@/server/config";

export const dynamic = "force-dynamic";

const querySchema = z.object({ task_id: z.string().uuid() });

function mirrorBase(): string {
  return hederaNetwork() === "mainnet"
    ? "https://mainnet.mirrornode.hedera.com"
    : "https://testnet.mirrornode.hedera.com";
}

async function topicMessages(topicId: string): Promise<Set<string>> {
  const found = new Set<string>();
  // Newest-first: the take verifies recent turns, and busy topics hold more
  // messages than one walk can cover from the oldest end.
  let url: string | null =
    `${mirrorBase()}/api/v1/topics/${encodeURIComponent(topicId)}/messages?encoding=utf8&limit=100&order=desc`;
  for (let page = 0; page < 5 && url; page++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`mirror node http ${res.status}`);
      const body = (await res.json()) as {
        messages?: Array<{ message?: string }>;
        links?: { next?: string | null };
      };
      for (const m of body.messages ?? []) {
        if (typeof m.message === "string") found.add(m.message);
      }
      const next = body.links?.next ?? null;
      url = next ? `${mirrorBase()}${next}` : null;
    } finally {
      clearTimeout(timer);
    }
  }
  return found;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({ task_id: url.searchParams.get("task_id") });
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: { code: "INVALID_REQUEST", message: "task_id must be a uuid" } },
        { status: 400 },
      );
    }
    const topicId = anchorTopicId();
    if (!topicId) {
      return Response.json(
        { ok: false, error: { code: "INVALID_REQUEST", message: "anchoring disabled — HCS_TOPIC_ID is not set" } },
        { status: 400 },
      );
    }
    const [task] = await db().select().from(tasks).where(eq(tasks.id, parsed.data.task_id));
    if (!task || task.tenantId !== (await demoTenantId())) {
      return Response.json(
        { ok: false, error: { code: "TASK_NOT_FOUND", message: `task not found: ${parsed.data.task_id}` } },
        { status: 404 },
      );
    }
    const rows = await db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.taskId, parsed.data.task_id))
      .orderBy(asc(auditEvents.id));
    const messages = await topicMessages(topicId);
    const events = rows.map((row) => {
      const fp = fingerprint({
        event_type: row.eventType,
        payload: (row.payload ?? {}) as Record<string, unknown>,
      });
      // Only allowlisted types are submitted (async projection, never the hot
      // path). The rest are display-derived — unverifiable by design, and the
      // UI must say so instead of implying tampering.
      const anchored = ANCHORED_TYPES.has(row.eventType);
      return {
        event_type: row.eventType,
        occurred_at: row.createdAt,
        fingerprint: fp,
        anchored,
        verified: anchored && messages.has(fp),
      };
    });
    const verified = events.filter((e) => e.verified).length;
    return Response.json({
      ok: true,
      data: {
        topic_id: topicId,
        network: hederaNetwork(),
        topic_url: `https://hashscan.io/${hederaNetwork()}/topic/${topicId}`,
        verified_count: verified,
        total: events.length,
        events,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: { code: "INTERNAL", message } }, { status: 500 });
  }
}

async function demoTenantId(): Promise<string | null> {
  const [tenant] = await db().select().from(tenants).where(eq(tenants.slug, config().DEMO_TENANT_SLUG));
  return tenant?.id ?? null;
}
