// Mock directory — swap `getAgents` for ERC-8004 Identity/Reputation
// registry reads (viem/wagmi + The Graph Agent0 subgraph) once the
// contract is deployed. Shape mirrors PROJECT.md §4 Agent.
export type AgentStatus = "online" | "idle" | "offline";

export type Agent = {
  registryId: number; // ERC-8004 token id (mock until deploy)
  agentKey: string; // agent:xxxx
  name: string;
  ens: string | null;
  owner: string;
  status: AgentStatus;
  reputation: number; // 0..1
  authorizations: number; // times authorized (ALLOW)
  escalated: number;
  denied: number;
  lastSeen: string;
  chain: string;
};

export const MOCK_AGENTS: Agent[] = [
  { registryId: 8472, agentKey: "agent:8472", name: "deploy-agent", ens: "deploy-8472.agent.eth", owner: "0x3f…9a1c", status: "online", reputation: 0.94, authorizations: 1284, escalated: 31, denied: 12, lastSeen: "12s ago", chain: "Sepolia" },
  { registryId: 9103, agentKey: "agent:9103", name: "review-bot", ens: "review-9103.agent.eth", owner: "0x71…4bd0", status: "online", reputation: 0.91, authorizations: 986, escalated: 18, denied: 5, lastSeen: "28s ago", chain: "Sepolia" },
  { registryId: 5521, agentKey: "agent:5521", name: "pay-runner", ens: null, owner: "0xa0…c742", status: "online", reputation: 0.88, authorizations: 742, escalated: 22, denied: 9, lastSeen: "45s ago", chain: "Hedera" },
  { registryId: 3188, agentKey: "agent:3188", name: "scan-seeker", ens: "scan-3188.agent.eth", owner: "0x22…f019", status: "online", reputation: 0.86, authorizations: 631, escalated: 14, denied: 7, lastSeen: "1m ago", chain: "Sepolia" },
  { registryId: 7740, agentKey: "agent:7740", name: "bridge-watch", ens: null, owner: "0x5b…8e33", status: "idle", reputation: 0.82, authorizations: 512, escalated: 27, denied: 19, lastSeen: "4m ago", chain: "Base" },
  { registryId: 1204, agentKey: "agent:1204", name: "ci-herald", ens: "ci-1204.agent.eth", owner: "0x9d…11ab", status: "online", reputation: 0.79, authorizations: 488, escalated: 9, denied: 4, lastSeen: "2m ago", chain: "Sepolia" },
  { registryId: 6630, agentKey: "agent:6630", name: "treasury-delta", ens: null, owner: "0xe4…60d2", status: "online", reputation: 0.76, authorizations: 355, escalated: 41, denied: 23, lastSeen: "3m ago", chain: "Hedera" },
  { registryId: 2917, agentKey: "agent:2917", name: "docs-scribe", ens: "docs-2917.agent.eth", owner: "0x17…b8f4", status: "idle", reputation: 0.73, authorizations: 301, escalated: 6, denied: 2, lastSeen: "9m ago", chain: "Sepolia" },
  { registryId: 4489, agentKey: "agent:4489", name: "risk-lens", ens: null, owner: "0x63…d5e7", status: "online", reputation: 0.69, authorizations: 244, escalated: 33, denied: 31, lastSeen: "5m ago", chain: "Base" },
  { registryId: 8361, agentKey: "agent:8361", name: "mempool cub", ens: "cub-8361.agent.eth", owner: "0x08…3c9a", status: "offline", reputation: 0.64, authorizations: 189, escalated: 12, denied: 15, lastSeen: "26m ago", chain: "Sepolia" },
  { registryId: 1029, agentKey: "agent:1029", name: "a2a-relay", ens: null, owner: "0xfb…47e1", status: "online", reputation: 0.93, authorizations: 1102, escalated: 25, denied: 8, lastSeen: "19s ago", chain: "Sepolia" },
  { registryId: 6155, agentKey: "agent:6155", name: "audit-trail", ens: "audit-6155.agent.eth", owner: "0x4c…92f6", status: "online", reputation: 0.9, authorizations: 874, escalated: 16, denied: 6, lastSeen: "51s ago", chain: "Base" },
];

// Future live path: replace body with contract/subgraph reads.
// Keeping the async signature so callers don't change.
export async function getAgents(): Promise<Agent[]> {
  return MOCK_AGENTS;
}
