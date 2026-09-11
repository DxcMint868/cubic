import { z } from "zod";
import { verifyCapability } from "@/server/capability/verify";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  capability_id: z.string().uuid(),
  action: z.string().min(1),
  resource: z.string().min(1),
});

// Non-consuming introspection for executors/tests: checks 1–6, no consume, no events.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { ok: false, error: { code: "INVALID_REQUEST", message: "invalid JSON body" } },
      { status: 400 },
    );
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        ok: false,
        error: {
          code: "INVALID_REQUEST",
          message: `invalid verify-capability body: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
        },
      },
      { status: 400 },
    );
  }
  const { capability_id, action, resource } = parsed.data;
  const result = await verifyCapability(capability_id, { action, resource });
  if (result.status === "issued") {
    return Response.json({ ok: true, data: { status: "issued" } });
  }
  return Response.json({ ok: true, data: { status: "rejected", reason: result.reason } });
}
