import { seed } from "@/server/demo/seed";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const counts = await seed();
    return Response.json({ ok: true, data: counts });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      { ok: false, error: { code: "INTERNAL", message } },
      { status: 500 },
    );
  }
}
