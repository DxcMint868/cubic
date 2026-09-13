import { desc } from "drizzle-orm";
import { db } from "@/server/db/client";
import { networkEvents } from "@/server/db/schema";
import {
  publicShape,
  subscribeNetwork,
  type NetworkRow,
} from "@/server/events/projection";

export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 15000;
const BACKLOG_LIMIT = 100;

// plan-08 EXACT — SSE, Content-Type: text/event-stream: first the last 100
// events as `event: network` frames (oldest first), then the live tail, plus
// a `: ping` comment heartbeat every 15s. Disconnect cleans up (no timers leak).
export async function GET() {
  const latest = await db()
    .select()
    .from(networkEvents)
    .orderBy(desc(networkEvents.id))
    .limit(BACKLOG_LIMIT);
  const backlog = [...latest].reverse();

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (row: NetworkRow) => {
        controller.enqueue(
          encoder.encode(`event: network\ndata: ${JSON.stringify(publicShape(row))}\n\n`),
        );
      };
      try {
        for (const row of backlog) send(row);
      } catch {
        // Client went away before the backlog flushed; cancel() cleans up.
      }
      unsubscribe = subscribeNetwork((row) => {
        try {
          send(row);
        } catch {
          // Controller closed; cancel() below removes this listener.
        }
      });
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          if (heartbeat) clearInterval(heartbeat);
        }
      }, HEARTBEAT_MS);
      const withUnref = heartbeat as unknown as { unref?: () => void };
      if (typeof withUnref.unref === "function") withUnref.unref();
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
      unsubscribe?.();
      unsubscribe = null;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
