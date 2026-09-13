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
    const topicUrl = `https://hashscan.io/${hederaNetwork()}/topic/${topicId}`;
    // Human visit (browser click on VERIFY ON HCS) → rendered page with
    // per-event verdicts + HashScan link. API clients (Accept: json / tests)
    // → the unchanged JSON envelope.
    const accept = request.headers.get("accept") ?? "";
    if (accept.includes("text/html")) {
      return new Response(renderVerifyPage(parsed.data.task_id, topicId, topicUrl, verified, events), {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    return Response.json({
      ok: true,
      data: {
        topic_id: topicId,
        network: hederaNetwork(),
        topic_url: topicUrl,
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

// Rendered verify page (monochrome, DESIGN.md): per-event VERIFIED /
// PENDING / NOT-ANCHORED verdicts + topic link. Escapes everything —
// fingerprints are hex but event types come from DB rows.
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderVerifyPage(
  taskId: string,
  topicId: string,
  topicUrl: string,
  verified: number,
  events: Array<{ event_type: string; occurred_at: unknown; fingerprint: string; anchored: boolean; verified: boolean }>,
): string {
  const rows = events
    .map((e) => {
      const verdict = e.verified ? "VERIFIED ✓" : e.anchored ? "PENDING — NOT ON TOPIC YET" : "NOT ANCHORED — DISPLAY-ONLY";
      const color = e.verified ? "#e8e8e8" : "#5a5a5a";
      return `<div style="border-bottom:1px solid rgba(255,255,255,.07);padding:12px 0;display:grid;gap:6px">
        <div style="display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap">
          <span style="font-size:12px;color:#e8e8e8">${esc(e.event_type)}</span>
          <span style="font-size:11px;color:${color}">${verdict}</span>
        </div>
        <div style="font-size:10.5px;color:#8a8a8a;word-break:break-all">fingerprint ${esc(e.fingerprint)}</div>
        <div style="font-size:10px;color:#5a5a5a">${esc(String(e.occurred_at))}</div>
      </div>`;
    })
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Verify on HCS — ${esc(taskId.slice(0, 8))}</title></head>
<body style="background:#000;color:#c9c9c9;font-family:ui-monospace,Menlo,Consolas,monospace;margin:0;padding:32px 20px">
<div style="max-width:760px;margin:0 auto">
<p style="font-size:11px;letter-spacing:.2em;color:#5a5a5a">CUBIC — VERIFY ON HCS</p>
<h1 style="font-size:26px;color:#f4f4f4;margin:12px 0">Task ${esc(taskId)}</h1>
<p style="font-size:12px;color:#8a8a8a">${verified} of ${events.length} events verified on topic
<a href="${esc(topicUrl)}" target="_blank" rel="noreferrer" style="color:#e8e8e8">${esc(topicId)}</a>
· <a href="${esc(topicUrl)}" target="_blank" rel="noreferrer" style="color:#e8e8e8">OPEN TOPIC ON HASHSCAN →</a></p>
<div style="margin-top:20px">${rows || '<p style="color:#5a5a5a">No audit events for this task.</p>'}</div>
</div></body></html>`;
}
