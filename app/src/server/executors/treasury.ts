// plan-11 treasury executor — dev-mode, explicitly labeled. No funds move:
// every action returns a deterministic simulated receipt. The authorization
// chain around it (normalize → policy → escalate/approve → capability →
// execution) is the real, tested behavior — same honesty framing as the
// plan-10 mock-always deploy case.
import type { Executor, ExecutorResult } from "./registry";

function usd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export class TreasuryExecutor implements Executor {
  async execute(input: Parameters<Executor["execute"]>[0]): Promise<ExecutorResult> {
    const { capability, args } = input;
    const rawAmount = (args as Record<string, unknown>).amount_usd_cents;
    // Display-only: non-numeric → 0, negatives floored at 0 (no funds move,
    // and authorization never depends on this value except the stake risk
    // split in normalize.ts). Treasury notionals are intentionally outside
    // the task-budget accounting (normalize sets no amount_usd_cents).
    const amount =
      typeof rawAmount === "number" && Number.isFinite(rawAmount) ? Math.max(0, Math.trunc(rawAmount)) : 0;
    switch (capability.action) {
      case "treasury_swap":
      case "treasury_transfer":
      case "treasury_stake":
        return {
          summary: `Treasury ${capability.action} ${usd(amount)} (dev mode)`,
          result: { action: capability.action, amount_usd_cents: amount, verdict: "simulated", mode: "dev" },
          mode: "dev",
        };
      default:
        throw new Error(`treasury executor: unsupported action ${capability.action}`);
    }
  }
}
