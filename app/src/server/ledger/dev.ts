import { config } from "../config";
import type { SecretProtector } from "./provider";
import { LedgerKeyRingProvider } from "./keyring";

// plan-12 EXACT — the dev stand-in for the SecretProtector seam. It provides
// ZERO protection: `protect` labels and discards the secret, `use` reads the
// named env var as plaintext. It exists to hold the seam so every secret read
// funnels through one interface and the hardware swap is one env var.
export class DevSecretProtector implements SecretProtector {
  async protect(name: string, _secret: string): Promise<string> {
    console.warn(`[ledger] DevSecretProtector: ${name} is NOT hardware-protected — dev stand-in only`);
    return `dev:${name}`;
  }
  async use(ref: string): Promise<string> {
    const name = ref.startsWith("dev:") ? ref.slice(4) : ref;
    const value = process.env[name];
    if (!value) throw new Error(`DevSecretProtector: ${name} is not set`);
    return value;
  }
}

let announced: string | null = null;

export function getSecretProtector(): SecretProtector {
  const backend = config().LEDGER_PROVIDER === "ledger" ? "keyring" : "dev";
  // Warn once per process (module-level memo) so the active backend is
  // visible in every run log without spamming per-call.
  if (announced !== backend) {
    announced = backend;
    console.warn(`[ledger] secret-protector backend: ${backend}` + (backend === "dev" ? " — NOT hardware-protected, dev stand-in only" : ""));
  }
  // EXACT deviation (documented): the plan's EXACT block compared
  // `backend === "ledger"`, which is unreachable (backend is "keyring" |
  // "dev") and would fail the plan's own AC 1 ("keyring backend under
  // LEDGER_PROVIDER=ledger"). Corrected to compare against the computed
  // backend value — the minimal fix satisfying the AC, nothing else changed.
  return backend === "keyring" ? new LedgerKeyRingProvider() : new DevSecretProtector();
}
