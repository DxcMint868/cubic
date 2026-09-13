import { randomBytes } from "node:crypto";
import { z } from "zod";
import { config } from "@/server/config";
import { buildX402Challenge, getPaymentProvider } from "@/server/payments/x402";

export const dynamic = "force-dynamic";

const scanRequest = z.object({
  target: z.string().min(1),
  settlement_ref: z.string().min(1).optional(),
});

// plan-05 EXACT — 402 envelope: extra payment fields live INSIDE error (plan-00 §G).
function paymentRequired(priceUsdCents: number, challenge: unknown, message: string): Response {
  return Response.json(
    {
      ok: false,
      error: {
        code: "PAYMENT_REQUIRED",
        message,
        price_usd_cents: priceUsdCents,
        network: "hedera",
        challenge,
      },
    },
    { status: 402 },
  );
}

// plan-04 dev report shape, unchanged (X402_DEV_BYPASS=1 restores this contract).
function devReport(target: string, priceUsdCents: number, mode: "dev" | "x402"): Response {
  return Response.json({
    ok: true,
    data: {
      report_id: `rpt_${randomBytes(4).toString("hex")}`,
      target,
      verdict: "clean",
      findings: [],
      mode,
      price_usd_cents: priceUsdCents,
    },
  });
}

// plan-05: the scanner is a genuinely x402-gated service settled through the
// Blocky402 facilitator on Hedera testnet. No valid payment → HTTP 402 with the
// spike-pinned challenge; a purchase round must present the settlement ref the
// gateway's payment phase recorded, and the service verifies it on the mirror
// node before returning the report.
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
  const { target, settlement_ref: settlementRef } = parsed.data;
  const priceUsdCents = config().X402_SCANNER_PRICE_CENTS;

  // Read raw (not the cached config singleton) so dev toggles apply per request
  // in tests; X402_DEV_BYPASS is a non-validating 0/1 switch, never a default.
  if (process.env.X402_DEV_BYPASS === "1") {
    console.warn(
      "[x402] DEV BYPASS ACTIVE — scanner served WITHOUT payment gating (settlement skipped, target=%j)",
      target,
    );
    return devReport(target, priceUsdCents, "dev");
  }

  const { challenge, degraded } = await buildX402Challenge();

  if (!settlementRef) {
    return paymentRequired(
      priceUsdCents,
      challenge,
      degraded
        ? "x402 payment required (degraded challenge: facilitator/mirror/operator env unreachable)"
        : "x402 payment required",
    );
  }

  if (usedSettlements.has(settlementRef)) {
    return paymentRequired(priceUsdCents, challenge, "x402 settlement already used");
  }

  const verified = await getPaymentProvider().verifySettlement({ challenge, settlement_ref: settlementRef });
  if (!verified) {
    return paymentRequired(priceUsdCents, challenge, "x402 settlement not verified on Hedera");
  }
  if (usedSettlements.size >= USED_CAP) usedSettlements.clear();
  usedSettlements.add(settlementRef);
  return devReport(target, priceUsdCents, "x402");
}

// Single-use settlement guard, in-process only (a restart loses it). MVP limit,
// documented in docs/payment-flow.md.
const usedSettlements = new Set<string>();
const USED_CAP = 1000;
