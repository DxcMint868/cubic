// One-shot: register OUR deploy-agent on Base Sepolia (ERC-8004) + leave
// feedback, so the demo reads live testnet trust instead of a static number.
//
// Needs (testnet only — never mainnet keys here):
//   OWNER_KEY   — throwaway Base Sepolia key, funded via any Base Sepolia
//                 faucet (it becomes the agent NFT owner)
//   CLIENT_KEY  — OPTIONAL second throwaway key (feedback MUST come from a
//                 non-owner; omit it and the script prints the manual step)
//   RPC_URL     — optional, defaults to public https://sepolia.base.org
//
// Run: pnpm --filter app exec tsx scripts/register-agent-8004.ts
// Prints: agentId, identity string (84532:<id>), Basescan links, QuickNode
// agent page, and polls the Base Sepolia Agent0 subgraph until indexed.
//
// Contracts (Base Sepolia, ERC-8004 canonical deployments):
//   Identity   0x8004a818bfb912233c491871b3d84c89a494bd9e
//   Reputation 0x8004b663056a597dffe9eccc1965a193b7388713
import { createPublicClient, createWalletClient, http, parseEventLogs } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const IDENTITY = "0x8004a818bfb912233c491871b3d84c89a494bd9e" as const;
const REPUTATION = "0x8004b663056a597dffe9eccc1965a193b7388713" as const;
const SUBGRAPH = "https://gateway.thegraph.com/api/REPLACE_WITH_KEY/subgraphs/id/4yYAvQLFjBhBtdRCY7eUWo181VNoTSLLFd5M7FXQAi6u";

const identityAbi = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentURI", type: "string" }],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
  {
    type: "event",
    name: "Registered",
    inputs: [
      { name: "agentId", type: "uint256", indexed: true },
      { name: "agentURI", type: "string", indexed: false },
      { name: "owner", type: "address", indexed: true },
    ],
  },
] as const;

const reputationAbi = [
  {
    type: "function",
    name: "giveFeedback",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "value", type: "int128" },
      { name: "valueDecimals", type: "uint8" },
      { name: "tag1", type: "string" },
      { name: "tag2", type: "string" },
      { name: "endpoint", type: "string" },
      { name: "feedbackURI", type: "string" },
      { name: "feedbackHash", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;

const registrationFileFor = (name: string, description: string) => ({
  type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  name,
  description,
  services: [],
  x402Support: false,
  active: true,
  supportedTrust: ["reputation"],
});

// The owned testnet roster. Scores stay at/above the 0.80 reputation floor so
// pipeline decisions are identical to today's static defaults — only the
// source of the number changes (hardcoded → onchain). agent:lab-1 is NOT here:
// it borrows live mainnet 8453:74108 (real negative feedback) for the
// escalation beat.
const ROSTER: Array<{ key: string; name: string; description: string; feedback: number }> = [
  {
    key: "agent:8472",
    name: "Cubic deploy-agent",
    description:
      "Demo agent for Cubic, the agent authorization gateway. Reads PRs, runs paid security scans, and escalates merges and deploys to a human approver. Used live on camera for the hackathon demo.",
    feedback: 95,
  },
  {
    key: "agent:treasury",
    name: "Cubic treasury-agent",
    description:
      "Capital-management demo agent for Cubic. Rebalances the treasury (swaps), pays payroll (transfers), and stakes — every high-risk move escalated to a human approver first.",
    feedback: 90,
  },
  {
    key: "agent:reader",
    name: "Cubic reader-agent",
    description:
      "Least-privilege demo agent for Cubic. Granted pull-request and file reads only — the standing example that capabilities are granted, not assumed.",
    feedback: 92,
  },
];

function dataUri(obj: unknown): string {
  return `data:application/json;base64,${Buffer.from(JSON.stringify(obj)).toString("base64")}`;
}

async function main(): Promise<void> {
  const ownerKey = process.env.OWNER_KEY as `0x${string}` | undefined;
  if (!ownerKey) throw new Error("set OWNER_KEY (throwaway Base Sepolia key, faucet-funded)");
  const rpc = process.env.RPC_URL ?? "https://sepolia.base.org";
  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpc) });
  const owner = privateKeyToAccount(ownerKey);
  const wallet = createWalletClient({ account: owner, chain: baseSepolia, transport: http(rpc) });

  console.log(`owner: ${owner.address}`);
  const balance = await publicClient.getBalance({ address: owner.address });
  console.log(`balance: ${balance} wei`);
  if (balance === BigInt(0)) throw new Error("owner has no Base Sepolia ETH — fund it from a faucet first");

  const uriFor = (entry: (typeof ROSTER)[number]) =>
    dataUri(registrationFileFor(entry.name, entry.description));

  const clientKey = process.env.CLIENT_KEY as `0x${string}` | undefined;
  const client = clientKey ? privateKeyToAccount(clientKey) : null;
  const clientWallet = client ? createWalletClient({ account: client, chain: baseSepolia, transport: http(rpc) }) : null;
  if (client) console.log(`feedback client: ${client.address}`);
  else console.log("No CLIENT_KEY — feedback steps print as manual instructions.");

  const identities: Array<{ key: string; agentId: bigint }> = [];
  for (const entry of ROSTER) {
    console.log(`\nregistering ${entry.key} (${entry.name})…`);
    const hash = await wallet.writeContract({
      address: IDENTITY,
      abi: identityAbi,
      functionName: "register",
      args: [uriFor(entry)],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const logs = parseEventLogs({ abi: identityAbi, logs: receipt.logs, eventName: "Registered" });
    const agentId = logs[0]?.args.agentId;
    if (agentId == null) throw new Error(`Registered event not found for ${entry.key}`);
    console.log(`  agent #${agentId} — https://sepolia.basescan.org/token/${IDENTITY}?a=${agentId}`);
    console.log(`  agent page: https://erc-8004.quicknode.com/agents/base-sepolia/${agentId}`);
    identities.push({ key: entry.key, agentId });

    if (clientWallet && client) {
      console.log(`  leaving feedback (${entry.feedback}/100) from ${client.address}…`);
      const fhash = await clientWallet.writeContract({
        address: REPUTATION,
        abi: reputationAbi,
        functionName: "giveFeedback",
        args: [agentId, BigInt(entry.feedback), 0, "demo", "deployment", "", "", `0x${"00".repeat(32)}`],
      });
      await publicClient.waitForTransactionReceipt({ hash: fhash });
      console.log(`  feedback tx: https://sepolia.basescan.org/tx/${fhash}`);
    } else {
      console.log(`  MANUAL feedback from a NON-owner wallet:`);
      console.log(`    Reputation.write.giveFeedback(${agentId}, ${entry.feedback}, 0, "demo", "deployment", "", "", 0x${"00".repeat(32)})`);
      console.log(`    contract: https://sepolia.basescan.org/address/${REPUTATION}#writeContract`);
    }
  }

  console.log("\nidentities for seed (erc8004_identity):");
  for (const { key, agentId } of identities) console.log(`  ${key} → 84532:${agentId}`);
  console.log(`\nsubgraph endpoint template:\n${SUBGRAPH}`);
  console.log("Next: set AGENT0_SUBGRAPH_URL to the Base Sepolia endpoint, pin the");
  console.log("identities above in seed, reseed, done.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
