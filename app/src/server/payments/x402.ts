import { config } from "../config";

// plan-05 EXACT — the payment-provider boundary. Implementations settle x402
// challenges through Blocky402 on Hedera (server-side payment authority only).
export interface PaymentProvider {
  pay(input: { capability_id: string; service: "scanner"; amount_usd_cents: number; challenge: unknown }): Promise<
    | { status: "completed"; settlement_ref: string }
    | { status: "failed"; error_code: string }
  >;
  verifySettlement(input: { challenge: unknown; settlement_ref: string }): Promise<boolean>;
}

// Spike-pinned (plan-05 ## Spike findings): Blocky402 facilitator + Hedera
// mirror node base URLs, selected by HEDERA_NETWORK. Testnet is open access;
// the mainnet URL is documented-but-unverified (Blocky402 lists it "coming
// soon") — do not treat it as a verified endpoint until the spike re-pins it.
const FACILITATOR_URLS: Record<"testnet" | "mainnet", string> = {
  testnet: "https://api.testnet.blocky402.com",
  mainnet: "https://api.blocky402.com/v1",
};
const MIRROR_URLS: Record<"testnet" | "mainnet", string> = {
  testnet: "https://testnet.mirrornode.hedera.com",
  mainnet: "https://mainnet.mirrornode.hedera.com",
};
const NETWORK_IDS: Record<"testnet" | "mainnet", `${string}:${string}`> = {
  testnet: "hedera:testnet",
  mainnet: "hedera:mainnet",
};
const FETCH_TIMEOUT_MS = 4000;
const CACHE_MS = 60_000;

// Spike-pinned challenge shape — the x402 v2 paymentRequirements object plus the
// Cubic `extra.price_usd_cents` extension. Optional fields degrade away when
// their source (facilitator / mirror / operator env) is unreachable; the 402
// status and envelope contract never change.
export interface X402Challenge {
  scheme: "exact";
  network: `${string}:${string}`;
  amount?: string;
  payTo?: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra?: { feePayer?: string; price_usd_cents: number };
}

// The merchant account the scanner revenue lands on. Optional env override for
// real deployments; MVP default is the operator account itself.
function payToAccount(): string | null {
  const envPayTo = process.env.X402_PAY_TO_ACCOUNT;
  if (typeof envPayTo === "string" && envPayTo.trim() !== "") return envPayTo.trim();
  return config().HEDERA_OPERATOR_ID ?? null;
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`x402: HTTP ${res.status} from ${url}`);
  return res.json();
}

let feePayerCache: { value: string | null; at: number } | null = null;
async function facilitatorFeePayer(): Promise<string | null> {
  if (feePayerCache && Date.now() - feePayerCache.at < CACHE_MS) return feePayerCache.value;
  let value: string | null = null;
  try {
    const c = config();
    const supported = (await fetchJson(`${FACILITATOR_URLS[c.HEDERA_NETWORK]}/supported`)) as {
      kinds?: Array<{ network?: string; extra?: { feePayer?: string } }>;
      signers?: Record<string, string[]>;
    };
    const networkId = NETWORK_IDS[c.HEDERA_NETWORK];
    const kind = supported?.kinds?.find?.((k) => k?.network === networkId);
    value = kind?.extra?.feePayer ?? supported?.signers?.["hedera:*"]?.[0] ?? null;
  } catch {
    value = null; // degraded: challenge ships without extra.feePayer
  }
  feePayerCache = { value, at: Date.now() };
  return value;
}

let rateCache: { hbar: number; cent: number; at: number } | null = null;
async function hbarUsdRate(): Promise<{ hbar: number; cent: number } | null> {
  if (rateCache && Date.now() - rateCache.at < CACHE_MS) return rateCache;
  try {
    const c = config();
    const body = (await fetchJson(`${MIRROR_URLS[c.HEDERA_NETWORK]}/api/v1/network/exchangerate`)) as {
      current_rate?: { cent_equivalent?: number; hbar_equivalent?: number };
    };
    const cent = body?.current_rate?.cent_equivalent;
    const hbar = body?.current_rate?.hbar_equivalent;
    if (typeof cent === "number" && typeof hbar === "number" && cent > 0 && hbar > 0) {
      rateCache = { hbar, cent, at: Date.now() };
      return rateCache;
    }
  } catch {
    // fall through to degraded
  }
  return null;
}

// tinybars = round(price_usd_cents * hbar_equivalent / cent_equivalent * 1e8)
// (spike-pinned: hbar_equivalent HBAR = cent_equivalent cents, mirror-verified)
export function tinybarsForUsdCents(cents: number, rate: { hbar: number; cent: number }): number {
  return Math.max(1, Math.round((cents * rate.hbar * 1e8) / rate.cent));
}

export interface X402ChallengeBuild {
  price_usd_cents: number;
  challenge: X402Challenge;
  degraded: boolean;
}

// Builds the live x402 v2 challenge for the scanner service (price from config,
// never hardcoded). Never throws — pieces the service cannot reach degrade away.
export async function buildX402Challenge(): Promise<X402ChallengeBuild> {
  const c = config();
  const price = c.X402_SCANNER_PRICE_CENTS;
  const [feePayer, rate] = await Promise.all([facilitatorFeePayer(), hbarUsdRate()]);
  const payTo = payToAccount();
  const tinybars = rate ? tinybarsForUsdCents(price, rate) : null;
  const degraded = tinybars == null || payTo == null || feePayer == null;
  const challenge: X402Challenge = {
    scheme: "exact",
    network: NETWORK_IDS[c.HEDERA_NETWORK],
    maxTimeoutSeconds: 300,
    asset: "0.0.0",
    ...(tinybars != null ? { amount: String(tinybars) } : {}),
    ...(payTo != null ? { payTo } : {}),
    extra: {
      price_usd_cents: price,
      ...(feePayer != null ? { feePayer } : {}),
    },
  };
  return { price_usd_cents: price, challenge, degraded };
}

// Discovery helper for the purchase wiring (plan-05 step 2): POST the service,
// parse its 402 envelope, hand back the price + challenge for provider.pay.
export async function fetchScannerChallenge(
  endpoint: string,
  target: string,
): Promise<{ price_usd_cents: number; challenge: unknown }> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (res.status !== 402) throw new Error(`x402 discovery: expected 402 from scanner service, got HTTP ${res.status}`);
  const body = (await res.json().catch(() => null)) as {
    ok?: boolean;
    error?: { code?: string; price_usd_cents?: number; challenge?: unknown };
  } | null;
  if (!body || body.ok !== false || body.error?.code !== "PAYMENT_REQUIRED") {
    throw new Error("x402 discovery: scanner service 402 without a PAYMENT_REQUIRED envelope");
  }
  const price = Number(body.error.price_usd_cents);
  if (!Number.isFinite(price) || price <= 0) throw new Error("x402 discovery: 402 without a usable price");
  return { price_usd_cents: price, challenge: body.error.challenge };
}

function x402NetworkId(): string {
  return NETWORK_IDS[config().HEDERA_NETWORK];
}

function challengeError(challenge: unknown, amountUsdCents: number): string | null {
  if (challenge === null || typeof challenge !== "object") return "INVALID_CHALLENGE";
  const ch = challenge as Partial<X402Challenge>;
  if (ch.scheme !== "exact") return "INVALID_CHALLENGE";
  if (ch.network !== x402NetworkId()) return "INVALID_CHALLENGE";
  if (typeof ch.amount !== "string" || !/^[0-9]+$/.test(ch.amount)) return "INVALID_CHALLENGE";
  if (typeof ch.payTo !== "string" || ch.payTo === "") return "INVALID_CHALLENGE";
  if (typeof ch.extra?.feePayer !== "string" || ch.extra.feePayer === "") return "INVALID_CHALLENGE";
  if (ch.extra.price_usd_cents !== amountUsdCents) return "PRICE_MISMATCH";
  return null;
}

export class HederaX402Provider implements PaymentProvider {
  // Settled requirements by network-native settlement ref: verifySettlement
  // re-checks the mirror against the EXACT requirements that were settled,
  // falling back to the caller-passed challenge for cross-process lookups.
  private settled = new Map<string, X402Challenge>();

  async pay(input: {
    capability_id: string;
    service: "scanner";
    amount_usd_cents: number;
    challenge: unknown;
  }): Promise<{ status: "completed"; settlement_ref: string } | { status: "failed"; error_code: string }> {
    void input.capability_id;
    const c = config();
    if (c.X402_SIMULATE_FAILURE === "1") {
      return { status: "failed", error_code: "SIMULATED_SETTLEMENT_FAILURE" };
    }
    if (!c.HEDERA_OPERATOR_ID || !c.HEDERA_OPERATOR_KEY) {
      return { status: "failed", error_code: "OPERATOR_NOT_CONFIGURED" };
    }
    const invalid = challengeError(input.challenge, input.amount_usd_cents);
    if (invalid) return { status: "failed", error_code: invalid };
    // challengeError guarantees scheme/network/amount/payTo/extra.feePayer —
    // rebuild a complete requirements object for the SDK + facilitator body.
    const raw = input.challenge as Partial<X402Challenge>;
    const rawExtra = (raw.extra ?? {}) as { feePayer?: string; price_usd_cents?: number };
    const feePayer = rawExtra.feePayer ?? "";
    const requirements: X402Challenge = {
      scheme: "exact",
      network: raw.network!,
      amount: raw.amount!,
      payTo: raw.payTo!,
      maxTimeoutSeconds: raw.maxTimeoutSeconds ?? 300,
      asset: raw.asset ?? "0.0.0",
      extra: { feePayer, price_usd_cents: rawExtra.price_usd_cents ?? input.amount_usd_cents },
    };
    try {
      const { createClientHederaSigner, PrivateKey } = await import("@x402/hedera");
      const { ExactHederaScheme } = await import("@x402/hedera/exact/client");
      const networkId = x402NetworkId();
      const signer = createClientHederaSigner(
        c.HEDERA_OPERATOR_ID,
        PrivateKey.fromStringECDSA(c.HEDERA_OPERATOR_KEY),
        { network: networkId },
      );
      const scheme = new ExactHederaScheme(signer);
      // challengeError validated scheme/network/amount/payTo/extra.feePayer, so
      // the wire object is exactly the x402 v2 paymentRequirements shape.
      const signed = await scheme.createPaymentPayload(
        2,
        requirements as Parameters<typeof scheme.createPaymentPayload>[1],
      );
      const paymentPayload = {
        x402Version: 2,
        scheme: "exact",
        network: requirements.network,
        accepted: requirements,
        payload: signed.payload,
      };
      const base = FACILITATOR_URLS[c.HEDERA_NETWORK];
      const body = JSON.stringify({ x402Version: 2, paymentPayload, paymentRequirements: requirements });

      const verifyRes = await fetch(`${base}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      const verify = (await verifyRes.json().catch(() => null)) as { isValid?: boolean; invalidReason?: string } | null;
      if (!verifyRes.ok || !verify || verify.isValid !== true) {
        return { status: "failed", error_code: `VERIFY_REJECTED${verify?.invalidReason ? `:${verify.invalidReason}` : ""}` };
      }

      const settleRes = await fetch(`${base}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      const settle = (await settleRes.json().catch(() => null)) as {
        success?: boolean;
        transaction?: string;
        errorReason?: string;
      } | null;
      if (!settleRes.ok || !settle || settle.success !== true || typeof settle.transaction !== "string" || settle.transaction === "") {
        return {
          status: "failed",
          error_code: `SETTLEMENT_FAILED${settle?.errorReason ? `:${settle.errorReason}` : ""}`,
        };
      }
      this.settled.set(settle.transaction, requirements);
      if (this.settled.size > 1000) {
        const oldest = this.settled.keys().next().value;
        if (oldest) this.settled.delete(oldest);
      }
      return { status: "completed", settlement_ref: settle.transaction };
    } catch {
      return { status: "failed", error_code: "SETTLEMENT_ERROR" };
    }
  }

  async verifySettlement(input: { challenge: unknown; settlement_ref: string }): Promise<boolean> {
    // Fail closed: only settlements THIS process made (recorded at settle time)
    // verify. A cache miss — restart, foreign process, or a mirror-scraped
    // third-party transfer crediting payTo — can never unlock a report.
    const requirements = this.settled.get(input.settlement_ref);
    if (!requirements) return false;
    const ch = requirements;
    if (typeof ch.payTo !== "string" || typeof ch.amount !== "string" || !/^[0-9]+$/.test(ch.amount)) return false;
    const required = Number(ch.amount);
    // Mirror node wants the dash form: 0.0.<payer>-<secs>-<nanos>. Both the @
    // and the timestamp dot are rejected / URL-encoding breaks the lookup.
    const [accountId, stamp] = input.settlement_ref.split("@");
    const txId = stamp ? `${accountId}-${stamp.replace(".", "-")}` : input.settlement_ref;
    const url = `${MIRROR_URLS[config().HEDERA_NETWORK]}/api/v1/transactions/${txId}`;
    // Mirror indexing lags settlement by seconds (observed spikes > 10 s on
    // testnet) — retry the read generously before giving up.
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (res.ok) {
          const body = (await res.json()) as {
            transactions?: Array<{ result?: string; transfers?: Array<{ account?: string; amount?: number }> }>;
          };
          const tx = body.transactions?.[0];
          const credited = (tx?.transfers ?? []).some(
            (t) => t.account === ch.payTo && typeof t.amount === "number" && t.amount >= required,
          );
          if (tx?.result === "SUCCESS" && credited) return true;
          if (tx) return false; // indexed but not a matching settlement
        }
      } catch {
        // mirror hiccup — retry
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    return false;
  }
}

let active: PaymentProvider | null = null;

export function setPaymentProvider(provider: PaymentProvider): void {
  active = provider;
}

export function getPaymentProvider(): PaymentProvider {
  if (!active) active = new HederaX402Provider();
  return active;
}
