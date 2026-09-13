// plan-11 treasury executor — dev-mode, explicitly labeled. No funds move:
// every action returns a deterministic simulated receipt shaped like a DEX
// quote ticket (venue, pair, tx hash) so it reads real on camera without
// touching money. The authorization chain around it (normalize → policy →
// escalate/approve → capability → execution) is the real, tested behavior —
// same honesty framing as the plan-10 mock-always deploy case.
import { createHash } from "node:crypto";
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
      case "treasury_stake": {
        const pair = (() => {
          const m = /^treasury\/([A-Za-z]+)\/([A-Za-z]+)$/.exec(capability.resource);
          return m ? `${m[1].toUpperCase()}→${m[2].toUpperCase()}` : capability.action;
        })();
        const venue = "uniswap-v3";
        const txHash = `0x${createHash("sha256")
          .update(`cubic-treasury|${capability.action}|${amount}|${capability.resource}`)
          .digest("hex")
          .slice(0, 40)}`;
        return {
          summary: `Treasury ${capability.action} ${usd(amount)} ${pair} via ${venue} ${txHash.slice(0, 10)}…`,
          result: {
            action: capability.action,
            amount_usd_cents: amount,
            pair,
            venue,
            quoted_rate: "1.0000",
            tx_hash: txHash,
            verdict: "settled",
            mode: "dev",
          },
          mode: "dev",
        };
      }
      default:
        throw new Error(`treasury executor: unsupported action ${capability.action}`);
    }
  }
}
