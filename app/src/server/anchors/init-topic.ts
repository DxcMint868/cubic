// plan-16 — HCS topic bootstrap (server/anchors/init-topic.ts).
//
// Creates the anchor topic post-top-up and prints the HCS_TOPIC_ID export:
//   pnpm --filter app hcs:init
//
// Prerequisite: a FUNDED testnet operator in app/.env.local
// (HEDERA_OPERATOR_ID + HEDERA_OPERATOR_KEY) — topic creation is an on-chain
// transaction and fails without HBAR. Top up at portal.hedera.com first.
// The operator key never leaves this process (no logging, no commits).
import "../load-env";

async function main(): Promise<void> {
  const operatorId = process.env.HEDERA_OPERATOR_ID;
  const operatorKey = process.env.HEDERA_OPERATOR_KEY;
  if (!operatorId || !operatorKey) {
    throw new Error(
      "init-topic: HEDERA_OPERATOR_ID + HEDERA_OPERATOR_KEY must be set in app/.env.local (top up at portal.hedera.com first)",
    );
  }
  const network = process.env.HEDERA_NETWORK === "mainnet" ? "mainnet" : "testnet";
  const sdk = (await import("@hiero-ledger/sdk")) as typeof import("@hiero-ledger/sdk");
  const client =
    network === "mainnet" ? sdk.Client.forMainnet() : sdk.Client.forTestnet();
  try {
    client.setOperator(
      sdk.AccountId.fromString(operatorId),
      sdk.PrivateKey.fromStringECDSA(operatorKey),
    );
    const tx = await new sdk.TopicCreateTransaction()
      .setTopicMemo("cubic audit anchors")
      .setAdminKey(sdk.PrivateKey.fromStringECDSA(operatorKey).publicKey)
      .execute(client);
    const receipt = await tx.getReceipt(client);
    const topicId = receipt.topicId?.toString();
    if (!topicId) throw new Error("init-topic: topic creation returned no topic id");
    console.log(`HCS topic created on ${network}: ${topicId}`);
    console.log(`Add to app/.env.local: HCS_TOPIC_ID=${topicId}`);
    console.log(`Explorer: https://hashscan.io/${network}/topic/${topicId}`);
  } finally {
    client.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
