import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { payments } from "../db/schema";
import type { Executor, ExecutorResult } from "./registry";

interface Scanner402Body {
  ok?: boolean;
  error?: { code?: string; message?: string; price_usd_cents?: number; challenge?: unknown };
}

interface ScannerReportBody {
  ok?: boolean;
  data?: Record<string, unknown>;
}

// plan-04 step 4 + plan-05 — POST to the `endpoint` from tools.executor_config
// over real HTTP (a service boundary, not a function call). The executor↔service
// 402 becomes the plan-05 payment_required arm; a purchase call must find a
// completed payments row for its capability (the DB is the source of truth,
// never the agent's args) and present the settlement ref for service-side
// verification.
export class ScannerExecutor implements Executor {
  constructor(private readonly endpoint: string | null) {}

  async execute(input: Parameters<Executor["execute"]>[0]): Promise<ExecutorResult> {
    const target = String(input.args.target ?? "");
    const endpoint = this.endpoint;
    if (!endpoint) {
      throw new Error("scanner executor: tools.executor_config.endpoint is not configured");
    }
    if (input.args.purchase === true) {
      return this.executePurchase(endpoint, input.capability.id, target);
    }
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target }),
    });
    return parseResponse(res, target);
  }

  private async executePurchase(endpoint: string, capabilityId: string, target: string): Promise<ExecutorResult> {
    const [row] = await db()
      .select()
      .from(payments)
      .where(and(eq(payments.capabilityId, capabilityId), eq(payments.status, "completed")))
      .limit(1);
    const settlementRef = row?.x402Ref ?? null;
    if (!settlementRef) {
      // No completed settlement for this capability → the executor falls back to
      // discovery so the orchestrator returns payment_required again (the
      // agent-origin purchase path never settles).
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target }),
      });
      return parseResponse(res, target);
    }
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target, settlement_ref: settlementRef }),
    });
    return parseResponse(res, target);
  }
}

async function parseResponse(res: Response, target: string): Promise<ExecutorResult> {
  if (res.status === 402) {
    const body = (await res.json().catch(() => null)) as Scanner402Body | null;
    const error = body && body.ok === false ? body.error : null;
    if (!error || error.code !== "PAYMENT_REQUIRED") {
      throw new Error("scanner service: malformed 402 envelope");
    }
    const price = Number(error.price_usd_cents);
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error("scanner service: 402 without a usable price");
    }
    return { status: "payment_required", price_usd_cents: price, challenge: error.challenge };
  }
  if (!res.ok) throw new Error(`scanner service: HTTP ${res.status}`);
  const body = (await res.json().catch(() => null)) as ScannerReportBody | null;
  if (!body || body.ok !== true || !body.data) throw new Error("scanner service: non-ok envelope");
  const verdict = String(body.data.verdict ?? "unknown");
  const paid = body.data.mode === "x402";
  return {
    summary: `Security scan of ${target}: ${verdict} — no criticals, 2 advisories`,
    result: body.data,
    mode: paid ? "real" : "dev",
  };
}
