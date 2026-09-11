import type { Executor, ExecutorResult } from "./registry";

// plan-04 step 4 — POST to the `endpoint` from tools.executor_config over real
// HTTP (a service boundary, not a function call). plan-05 extends this with
// the 402 → payment_required mapping.
export class ScannerExecutor implements Executor {
  constructor(private readonly endpoint: string | null) {}

  async execute(input: Parameters<Executor["execute"]>[0]): Promise<ExecutorResult> {
    const target = String(input.args.target ?? "");
    if (!this.endpoint) {
      throw new Error("scanner executor: tools.executor_config.endpoint is not configured");
    }
    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target }),
    });
    if (!res.ok) throw new Error(`scanner service: HTTP ${res.status}`);
    const body = (await res.json()) as { ok?: boolean; data?: Record<string, unknown> };
    if (!body.ok || !body.data) throw new Error("scanner service: non-ok envelope");
    const verdict = String(body.data.verdict ?? "unknown");
    // plan-04: the service is dev-mode; plan-05 extends this with the 402
    // arm and real settlement modes.
    return {
      summary: `Security scan of ${target}: ${verdict} (dev mode)`,
      result: body.data,
      mode: "dev",
    };
  }
}
