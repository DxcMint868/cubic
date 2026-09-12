// plan-13 EXACT — ledger-backend boot gate. Under an explicit
// LEDGER_PROVIDER=ledger selection, the gateway must not half-boot and then
// fail opaquely per payment: assert the Key Ring is provisioned (cheap
// local-cache read, no device) and abort with an actionable message instead.
// The dev boot path is untouched: any other selection short-circuits to ok
// without touching wallet-cli.
//
// Sandbox constraint: this module is reachable from the Next.js
// instrumentation graph, which compiles an edge-runtime bundle where node
// builtins cannot be statically resolved. The child_process import is
// therefore runtime-only (variable specifier + webpackIgnore) and the ring
// probe is injectable so tests never need the real wallet-cli. Config/db are
// deliberately NOT imported (their load-env chain uses node builtins).
import { logger } from "../logging";

export interface LedgerBootGateResult {
  ok: boolean;
  message: string | null;
}

async function probeRingProvisioned(): Promise<boolean> {
  if (process.env.LEDGER_PROVIDER !== "ledger") return false;
  // Same contract as keyring.runRaw: WALLET_PASS is required in non-TTY.
  if (!process.env.WALLET_PASS) return false;
  const specifier = ["node", "child_process"].join(":");
  const { execFile } = (await import(/* webpackIgnore: true */ specifier)) as typeof import("node:child_process");
  const bin = process.env.LEDGER_WALLET_CLI_PATH ?? "wallet-cli";
  return new Promise<boolean>((resolve) => {
    execFile(bin, ["ring", "keys", "--output", "json"], { env: process.env, timeout: 15_000 }, (err, stdout) => {
      if (err) {
        resolve(false);
        return;
      }
      try {
        resolve((JSON.parse(stdout) as { ok?: boolean }).ok === true);
      } catch {
        resolve(false);
      }
    });
  });
}

export async function ledgerBootGate(
  probe: () => Promise<boolean> = probeRingProvisioned,
): Promise<LedgerBootGateResult> {
  if (process.env.LEDGER_PROVIDER !== "ledger") return { ok: true, message: "" };
  const log = logger("ledger");
  if (await probe()) return { ok: true, message: "" };
  const message = "Key Ring not provisioned — run wallet-cli ring init on a device host";
  log.error(message, { LEDGER_PROVIDER: "ledger" });
  return { ok: false, message };
}
