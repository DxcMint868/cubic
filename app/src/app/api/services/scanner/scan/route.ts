import { randomBytes } from "node:crypto";
import { z } from "zod";
import { config } from "@/server/config";

export const dynamic = "force-dynamic";

const scanRequest = z.object({ target: z.string().min(1) });

// plan-04 EXACT — the paid scanner service in dev mode: a deterministic clean
// report. plan-05 gates this route behind the x402 402 challenge on Hedera.
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
  const parsed = scanRequest.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        ok: false,
        error: {
          code: "INVALID_REQUEST",
          message: `invalid request: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
        },
      },
      { status: 400 },
    );
  }
  const { target } = parsed.data;
  return Response.json({
    ok: true,
    data: {
      report_id: `rpt_${randomBytes(4).toString("hex")}`,
      target,
      verdict: "clean",
      findings: [],
      mode: "dev",
      price_usd_cents: config().X402_SCANNER_PRICE_CENTS,
    },
  });
}
