// plan-16 EXACT — HCS fingerprint anchoring (server/anchors/hcs.ts).
//
// Async projection, never the hot path: the projection step calls
// anchorEvent() synchronously (one line) and moves on — submission is
// fire-and-forget, catch-all warn, never awaited in the decision path.
//
// Byte-identity contract: canonicalEnvelope() commits to {event_type,
// payload} ONLY (sorted-key JSON). DB timestamps are NOT byte-stable between
// the submit path (envelope.occurred_at, set at emit time) and the display
// path (audit_events.created_at, set by the DB clock), so including them
// would break submit/display equality by construction. Ordering comes from
// the HCS topic sequence — the mirror node is the record.
//
// NO receipt storage (zero schema change). Env: HCS_TOPIC_ID (created
// post-top-up by `pnpm --filter app hcs:init`). Absent topic =
// anchor-disabled (warn once), never throw. Failure mode is warn-only, always.

import { createHash } from "node:crypto";
import { logger } from "../logging";

const log = logger("anchors");

// plan-16 EXACT — allowlisted types. Only these submit; anything else is
// skipped silently (same pattern as the network_events projection).
export const ANCHORED_TYPES: ReadonlySet<string> = new Set([
  "policy.evaluated",
  "capability.issued",
  "capability.denied",
  "capability.escalated",
  "capability.consumed",
  "capability.rejected",
  "payment.completed",
  "payment.failed",
  "ledger.approval.completed",
  "task.completed",
]);

export interface AnchorInput {
  event_type: string;
  occurred_at?: string;
  payload: Record<string, unknown>;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

// Pure shared helper — the SINGLE source of truth for submit AND display.
// Byte-identical by construction: no copies anywhere else.
export function canonicalEnvelope(input: AnchorInput): string {
  return JSON.stringify(sortKeys({ event_type: input.event_type, payload: input.payload ?? {} }));
}

// Pure shared helper — hex-sha256 of the canonical bytes.
export function fingerprint(input: AnchorInput): string {
  return createHash("sha256").update(canonicalEnvelope(input)).digest("hex");
}

export function anchorTopicId(): string | null {
  const raw = process.env.HCS_TOPIC_ID;
  return raw && raw.trim() !== "" ? raw.trim() : null;
}

export function hederaNetwork(): "testnet" | "mainnet" {
  return process.env.HEDERA_NETWORK === "mainnet" ? "mainnet" : "testnet";
}

// Topic-explorer link. Real when a topic is configured, absent otherwise —
// callers must render real-or-absent, never a fabricated link.
export function topicUrl(topicId: string, network: "testnet" | "mainnet" = hederaNetwork()): string {
  return `https://hashscan.io/${network}/topic/${topicId}`;
}

// -- Submission ---------------------------------------------------------------

export interface AnchorSubmitter {
  submit(fingerprintHex: string): Promise<string>;
}

let submitter: AnchorSubmitter | null = null;
let disabledWarned = false;
const pending = new Set<Promise<unknown>>();

export function setAnchorSubmitter(next: AnchorSubmitter | null): void {
  submitter = next;
}

// Test hook: reset the warn-once flag + drop the override.
export function resetAnchorsForTests(): void {
  submitter = null;
  disabledWarned = false;
}

export async function flushAnchors(): Promise<void> {
  await Promise.all([...pending]);
}

async function defaultSubmit(fingerprintHex: string): Promise<string> {
  const topicId = anchorTopicId();
  if (!topicId) throw new Error("HCS_TOPIC_ID is not configured");
  // Dynamic import: @hiero-ledger/sdk rides in devDependencies (no new runtime
  // deps per the plan fence). If it is ever uninstallable, the catch in
  // anchorEvent turns it into the standard warn-only path.
  const sdk = (await import("@hiero-ledger/sdk")) as typeof import("@hiero-ledger/sdk");
  const network = hederaNetwork();
  const client = network === "mainnet" ? sdk.Client.forMainnet() : sdk.Client.forTestnet();
  try {
    const operatorId = process.env.HEDERA_OPERATOR_ID;
    const operatorKey = process.env.HEDERA_OPERATOR_KEY;
    if (!operatorId || !operatorKey) throw new Error("Hedera operator env is not configured");
    client.setOperator(
      sdk.AccountId.fromString(operatorId),
      sdk.PrivateKey.fromStringECDSA(operatorKey),
    );
    const tx = await new sdk.TopicMessageSubmitTransaction()
      .setTopicId(sdk.TopicId.fromString(topicId))
      .setMessage(fingerprintHex)
      .execute(client);
    const receipt = await tx.getReceipt(client);
    return receipt.topicSequenceNumber?.toString() ?? "submitted";
  } finally {
    client.close();
  }
}

// The ONE call the projection step makes. Synchronous, never throws:
// unallowlisted types skip, absent topic warns once, every failure warns.
export function anchorEvent(input: AnchorInput): void {
  try {
    if (!ANCHORED_TYPES.has(input.event_type)) return;
    const topicId = anchorTopicId();
    if (!topicId) {
      if (!disabledWarned) {
        disabledWarned = true;
        log.warn("HCS anchoring disabled — HCS_TOPIC_ID is not set (create it post-top-up: pnpm --filter app hcs:init)");
      }
      return;
    }
    const fp = fingerprint(input);
    // A never-settling submitter must not pin `pending` forever (flushAnchors
    // is test-only): race the submit against a warn-and-drop timeout.
    const attempt = (submitter ? submitter.submit(fp) : defaultSubmit(fp));
    const bounded = Promise.race([
      attempt,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("HCS anchor submit timed out")), 30_000),
      ),
    ]).then(
      () => undefined,
      (err: unknown) => {
        log.warn("HCS anchor submit failed (warn-only)", {
          event_type: input.event_type,
          error: err instanceof Error ? err.message : String(err),
        });
      },
    );
    const run = bounded;
    pending.add(run);
    void run.finally(() => {
      pending.delete(run);
    });
  } catch (err) {
    log.warn("HCS anchor hook failed (warn-only)", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
