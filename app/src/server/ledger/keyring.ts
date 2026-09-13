import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { db } from "../db/client";
import { approvals } from "../db/schema";
import { config } from "../config";
import type { ApprovalRequestInput, ApprovalProvider } from "../gateway/approval/provider";
import type { SecretProtector } from "./provider";

// plan-06 spike-pinned subcommands (wallet-cli v2.1.0):
//   wallet-cli ring encrypt --key <name> --output json   (text via stdin/stdout)
//   wallet-cli ring decrypt --key <name> --output json   (text via stdin/stdout)
// The ring password comes from WALLET_PASS whenever there is no TTY.
const RING_EVIDENCE_KEY = "cubic-approvals";

interface RingJson {
  ok: boolean;
  data?: unknown;
  error?: { message?: string };
}

// Best-effort ciphertext extraction from the ring JSON envelope: the exact
// success `data` shape is not verifiable without a provisioned device (see
// docs/ledger.md), so accept any obvious string payload field and throw
// rather than silently mangle.
function extractString(data: unknown): string {
  if (typeof data === "string") return data;
  if (data && typeof data === "object") {
    for (const key of ["ciphertext", "plaintext", "result", "content", "text", "value", "output"]) {
      const v = (data as Record<string, unknown>)[key];
      if (typeof v === "string") return v;
    }
    for (const v of Object.values(data as Record<string, unknown>)) {
      if (typeof v === "string" && v.length > 0) return v;
    }
  }
  throw new Error("wallet-cli ring: could not locate payload string in JSON output");
}

export class LedgerKeyRingProvider implements ApprovalProvider, SecretProtector {
  private bin(): string {
    return config().LEDGER_WALLET_CLI_PATH ?? "wallet-cli";
  }

  private runRaw(args: string[], stdin: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!process.env.WALLET_PASS) {
        reject(new Error("WALLET_PASS is not set — the Ledger Key Ring requires it in non-TTY contexts"));
        return;
      }
      const child = execFile(
        this.bin(),
        args,
        { env: process.env, maxBuffer: 16 * 1024 * 1024 },
        (err, stdout) => {
          if (err) {
            reject(new Error(`wallet-cli ring ${args[1]} failed: ${err.message}`));
            return;
          }
          resolve(stdout);
        },
      );
      child.stdin?.end(stdin);
    });
  }

  private async ringJson(args: string[], stdin: string): Promise<unknown> {
    const stdout = await this.runRaw(args, stdin);
    let parsed: RingJson;
    try {
      parsed = JSON.parse(stdout) as RingJson;
    } catch {
      throw new Error(`wallet-cli ring ${args[1]}: unparseable output`);
    }
    if (!parsed.ok) {
      throw new Error(`wallet-cli ring ${args[1]}: ${parsed.error?.message ?? "unknown error"}`);
    }
    return parsed.data;
  }

  private async encrypt(keyName: string, plaintext: string): Promise<string> {
    const data = await this.ringJson(["ring", "encrypt", "--key", keyName, "--output", "json"], plaintext);
    return extractString(data);
  }

  private async decrypt(keyName: string, ciphertext: string): Promise<string> {
    const data = await this.ringJson(["ring", "decrypt", "--key", keyName, "--output", "json"], ciphertext);
    return extractString(data);
  }

  // Probe: raw `ring keys` output; ok:false when the ring is not provisioned.
  async probeKeys(): Promise<string> {
    return this.runRaw(["ring", "keys", "--output", "json"], "");
  }

  // ApprovalProvider: record approval evidence via the ring. Any wallet-cli
  // failure throws — no silent fallback to dev (the user opts in via env).
  async request(input: ApprovalRequestInput): Promise<{ approval_id: string }> {
    const evidence = JSON.stringify({
      decision_id: input.decision_id,
      action: input.action,
      resource: input.resource,
      risk_class: input.risk_class,
      reason_codes: input.reason_codes,
      recorded_at: new Date().toISOString(),
    });
    const ciphertext = await this.encrypt(RING_EVIDENCE_KEY, evidence);
    const providerRef = `ring:encrypt:${RING_EVIDENCE_KEY}:${createHash("sha256").update(ciphertext).digest("hex").slice(0, 16)}`;
    const [row] = await db()
      .insert(approvals)
      .values({
        decisionId: input.decision_id,
        type: "ledger",
        provider: "ledger",
        status: "pending",
        providerRef,
        council: input.council ?? null,
      })
      .returning();
    return { approval_id: row.id };
  }

  // SecretProtector: wrap a secret under Key Ring encryption at rest. The
  // returned ref carries the ring key name (`ring:<name>:<ciphertext>`) so
  // `use` can decrypt under the same key the secret was protected with.
  async protect(name: string, secret: string): Promise<string> {
    const ciphertext = await this.encrypt(name, secret);
    return `ring:${name}:${ciphertext}`;
  }

  async use(ref: string): Promise<string> {
    const prefix = "ring:";
    if (!ref.startsWith(prefix)) {
      throw new Error(`keyring use: unrecognized ref format (expected ${prefix}<name>:<ciphertext>)`);
    }
    const rest = ref.slice(prefix.length);
    const sep = rest.indexOf(":");
    if (sep <= 0) {
      throw new Error("keyring use: ref is missing the ring key name");
    }
    return this.decrypt(rest.slice(0, sep), rest.slice(sep + 1));
  }
}

let singleton: LedgerKeyRingProvider | null = null;

export function ledgerApprovalProvider(): LedgerKeyRingProvider {
  if (!singleton) singleton = new LedgerKeyRingProvider();
  return singleton;
}

// Test/diagnostic probe: true only when the Key Ring is provisioned on this
// host (`ring keys` is a local-cache read — no device, no network). Tests
// skip cleanly when this returns false.
export async function ringProvisioned(): Promise<boolean> {
  try {
    const stdout = await new LedgerKeyRingProvider().probeKeys();
    return (JSON.parse(stdout) as RingJson).ok === true;
  } catch {
    return false;
  }
}
