import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import MacWindow from "@/components/MacWindow";

const monoLabel: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: "0.2em",
  color: "#5a5a5a",
};

const h2: React.CSSProperties = {
  marginTop: 56,
  fontSize: "clamp(24px, 3vw, 36px)",
  fontWeight: 700,
  letterSpacing: "-0.02em",
  lineHeight: 1.15,
  color: "#f4f4f4",
};

const body: React.CSSProperties = {
  marginTop: 14,
  fontSize: 15.5,
  lineHeight: 1.7,
  color: "#b5b5b5",
  maxWidth: 780,
};

const addr: React.CSSProperties = {
  fontFamily: "ui-monospace, SF Mono, Menlo, monospace",
  fontSize: 12.5,
  color: "#f4f4f4",
  wordBreak: "break-all",
};

const tableWrap: React.CSSProperties = {
  marginTop: 18,
  border: "1px solid #232323",
  borderRadius: 10,
  overflow: "hidden",
};

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 14px",
  fontSize: 10.5,
  letterSpacing: "0.16em",
  color: "#6a6a6a",
  borderBottom: "1px solid #232323",
  fontFamily: "ui-monospace, SF Mono, Menlo, monospace",
};

const td: React.CSSProperties = {
  padding: "12px 14px",
  fontSize: 13.5,
  lineHeight: 1.6,
  color: "#c9c9c9",
  borderBottom: "1px solid #161616",
  verticalAlign: "top",
};

const codeBlock: React.CSSProperties = {
  marginTop: 16,
  background: "#0d0d0d",
  border: "1px solid #232323",
  borderRadius: 10,
  padding: "16px 18px",
  fontFamily: "ui-monospace, SF Mono, Menlo, monospace",
  fontSize: 12.5,
  lineHeight: 1.7,
  color: "#d8d8d8",
  overflowX: "auto",
  whiteSpace: "pre",
};

function SectionNum({ n, title }: { n: string; title: string }) {
  return (
    <h2 id={`s${n}`} style={h2} className="mono">
      <span style={{ color: "#5a5a5a" }}>{n} — </span>
      <span style={{ fontFamily: "inherit" }}>{title}</span>
    </h2>
  );
}

export default function DocsPage() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        background: "#000",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <SiteHeader active="DOCS" />

      <div className="section-pad" style={{ flex: 1, maxWidth: 1080, margin: "0 auto", width: "100%" }}>
        {/* Title block */}
        <p className="mono" style={monoLabel}>
          CUBIC □ WHITEPAPER — V1.0 · SEPTEMBER 2026
        </p>
        <h1
          style={{
            marginTop: 18,
            fontSize: "clamp(40px, 5.5vw, 76px)",
            fontWeight: 800,
            letterSpacing: "-0.03em",
            lineHeight: 1.02,
            color: "#f4f4f4",
          }}
        >
          The Agent Authorization Network.
        </h1>
        <p style={{ ...body, fontSize: 17, color: "#8a8a8a", maxWidth: 760 }}>
          Cloudflare for agent actions. Agents never hold credentials — every tool call is
          interrogated against identity, intent, policy, and trust, then allowed, denied,
          or escalated. Allowed actions receive scoped five-minute capabilities, not keys.
        </p>
        <p className="mono" style={{ marginTop: 18, fontSize: 11, letterSpacing: "0.14em", color: "#5a5a5a" }}>
          ABSTRACT · INTENT → POLICY → CAPABILITY → EXECUTION → AUDIT · LIVE ON BASE SEPOLIA + HEDERA TESTNET
        </p>

        {/* TOC */}
        <MacWindow title="CONTENTS — READ IN ORDER">
          <div className="mono" style={{ padding: "18px 20px", fontSize: 12.5, lineHeight: 2.1, color: "#9a9a9a" }}>
            {[
              ["01", "The problem: credential possession is not authority"],
              ["02", "What Cubic is — and is not"],
              ["03", "Architecture: the authorization gateway"],
              ["04", "Core flow + data model"],
              ["05", "Deterministic policy engine"],
              ["06", "Trust context: ERC-8004 × The Graph"],
              ["07", "Machine payments: x402 on Hedera"],
              ["08", "Human approvals: wallets + Ledger + HCS anchoring"],
              ["09", "Onchain registry — every contract, account & topic"],
              ["10", "Demo tenant: Acme (fiction boundary)"],
              ["11", "Integration surface: MCP + API + events"],
              ["12", "Security properties & honesty guarantees"],
              ["13", "Run it yourself"],
              ["14", "Sources"],
            ].map(([n, t]) => (
              <div key={n}>
                <a href={`#s${n}`} className="link" style={{ color: "#c9c9c9" }}>
                  <span style={{ color: "#5a5a5a" }}>{n}</span> · {t}
                </a>
              </div>
            ))}
          </div>
        </MacWindow>

        <SectionNum n="01" title="The problem" />
        <p style={body}>
          Modern agents hold long-lived credentials for GitHub, Slack, wallets, and DeFi.
          Once the credential reaches the agent process, prompt injection, malicious tool
          output, or a compromised MCP server turns one intended action into general access.
          The fix is to change the unit of authorization from{" "}
          <span style={{ color: "#f4f4f4" }}>credential possession</span> to{" "}
          <span style={{ color: "#f4f4f4" }}>action capability</span>: instead of “here is a
          GitHub token, you can use GitHub,” the agent receives “agent 8472 may merge PR #421
          in acme/backend, under policy X, until timestamp T” — and nothing else.
        </p>

        <SectionNum n="02" title="What Cubic is — and is not" />
        <div style={{ ...body, maxWidth: 820 }}>
          <p><span style={{ color: "#f4f4f4" }}>It is:</span> an agent-facing authorization gateway ·
          a capability broker · a deterministic policy layer · an intent-to-action audit system ·
          an identity/reputation consumer · a secret-protection seam · a multi-tenant control
          plane · a network observability surface.</p>
          <p style={{ marginTop: 10 }}>
          <span style={{ color: "#f4f4f4" }}>It is not:</span> a replacement for Composio or API
          integrations · a secrets manager · a blockchain that executes tool calls · an LLM that
          decides ALLOW/DENY · a decentralized agent OS. Rule:{" "}
          <span style={{ color: "#f4f4f4" }}>we authorize agent actions; existing systems execute them.</span></p>
        </div>

        <SectionNum n="03" title="Architecture" />
        <p style={body}>
          The gateway sits between the agent and its tools. It identifies the agent, normalizes
          the tool call into a structured intent, gathers context (reputation, validation, task,
          budget), evaluates deterministic policy, issues a scoped capability or escalates, and
          records the full chain. Downstream executors — MCP servers, Composio, native adapters —
          perform the concrete API calls.
        </p>
        <div style={codeBlock}>{`agent → MCP tool call → gateway [identify → normalize → context → policy]
  → ALLOW → capability (5 min, single action+resource) → executor → tool API
  → DENY (no capability, no execution)
  → ESCALATE → human wallet approval → capability → executor
  every step → audit event → HCS fingerprint anchor`}</div>

        <SectionNum n="04" title="Core flow + data model" />
        <p style={body}>
          Agent → Intent → Policy/Context evaluation → Allow | Deny | Escalate → Capability →
          Tool execution → Result → Audit event. Intents carry task, agent, normalized action,
          resource, and risk class. Decisions record the matched rule, reasons, and risk score.
          Capabilities are narrowly scoped, 5-minute, policy-hash-bound artifacts — replayed or
          expired consumes are rejected with explicit reason codes (replay, expired, not_found,
          revoked). The audit chain connects intent → decision → capability → execution → result
          per task and is queryable via trace APIs.
        </p>

        <SectionNum n="05" title="Deterministic policy engine" />
        <p style={body}>
          LLMs draft and summarize intent; they never authorize. A pure rule engine decides
          ALLOW / DENY / ESCALATE with first-match-wins semantics over versioned policy documents
          (default-v1 for general tools, payment-v1 for spend: service allowlist · task budget ·
          reputation floor 0.80). Risk classes: reads are low, merges/deploys and money movement
          are high and always escalate. Reason codes are verbatim and stable: tool_not_allowed,
          secret_resource, resource_outside_task, budget_exceeded, reputation_below_threshold,
          risk_requires_approval.
        </p>

        <SectionNum n="06" title="Trust context: ERC-8004 × The Graph" />
        <p style={body}>
          Demo agents hold real ERC-8004 onchain identities. Reputation is read live from The
          Graph&apos;s Agent0 subgraph and changes real outcomes: the contractor agent lab-1
          carries genuine negative feedback onchain, so the gateway escalates everything it does.
          The console shows the exact GraphQL query and The Graph&apos;s verbatim response per
          agent — the trust signal comes from the indexer, never our database. Hedera hosts no
          ERC-8004 contracts: read-on-Base, enforce-on-Hedera.
        </p>

        <SectionNum n="07" title="Machine payments: x402 on Hedera" />
        <p style={body}>
          Paid services answer <span style={addr}>402 Payment Required</span> with a $0.25 quote.
          The gateway checks the task&apos;s spend policy (approved service · amount ≤ remaining
          budget · reputation), then the server-held payment authority settles in HBAR on Hedera
          testnet through the Blocky402 facilitator (/verify → /settle, x402 v2). The settlement
          reference is recorded on the payment row and the merchant independently verifies it
          against the mirror node before returning any report. The agent never touches a wallet key.
        </p>

        <SectionNum n="08" title="Human approvals + anchoring" />
        <p style={body}>
          High-risk actions escalate to named approval councils (deploy-council, treasury-council).
          The approver signs with their own wallet (EIP-191 personal_sign); the server verifies the
          signature against the registered approver address and seals signer + signature into the
          approval event. Ledger is the hardware root-of-trust path (wallet-cli ring / Key Ring);
          without a device the dev provider is used and honestly labeled DEV (stand-in) — never
          claimed as hardware security. Every allowlisted audit event is sha256-fingerprinted and
          submitted fire-and-forget to a Hedera Consensus Service topic; the verify page recomputes
          each fingerprint against the mirror node (VERIFIED / PENDING / NOT-ANCHORED).
        </p>

        <SectionNum n="09" title="Onchain registry" />
        <p style={body}>
          Everything below is public and safe to share. No private keys appear anywhere in this
          repo&apos;s docs — signing keys live only in the gitignored{" "}
          <span style={addr}>app/.env.local</span> (HEDERA_OPERATOR_KEY, AGENT_OWNER_KEY) and are
          never printed, logged, or committed. What is written out here is the verifiable public
          surface: contracts, identities, accounts, topics, and explorers.
        </p>

        <div style={tableWrap}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>ARTIFACT</th>
                <th style={th}>VALUE</th>
                <th style={th}>VERIFY</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={td} className="mono">ERC-8004 Identity<br />Base Sepolia</td>
                <td style={td}><span style={addr}>0x8004a818bfb912233c491871b3d84c89a494bd9e</span></td>
                <td style={td} className="mono"><a className="link" href="https://sepolia.basescan.org/address/0x8004a818bfb912233c491871b3d84c89a494bd9e">basescan ↗</a></td>
              </tr>
              <tr>
                <td style={td} className="mono">ERC-8004 Reputation<br />Base Sepolia</td>
                <td style={td}><span style={addr}>0x8004b663056a597dffe9eccc1965a193b7388713</span></td>
                <td style={td} className="mono"><a className="link" href="https://sepolia.basescan.org/address/0x8004b663056a597dffe9eccc1965a193b7388713#writeContract">basescan ↗</a></td>
              </tr>
              <tr>
                <td style={td} className="mono">Agent0 subgraph<br />deployment ID</td>
                <td style={td}><span style={addr}>4yYAvQLFjBhBtdRCY7eUWo181VNoTSLLFd5M7FXQAi6u</span><br /><span className="mono" style={{ fontSize: 11, color: "#6a6a6a" }}>gateway.thegraph.com/api/&lt;KEY&gt;/subgraphs/id/…</span></td>
                <td style={td} className="mono"><a className="link" href="https://thegraph.com/docs/en/subgraphs/existing-subgraphs/agent0/">graph docs ↗</a></td>
              </tr>
              <tr>
                <td style={td} className="mono">deploy-agent</td>
                <td style={td}><span style={addr}>84532:9223</span> · feedback 95/100</td>
                <td style={td} className="mono"><a className="link" href="https://erc-8004.quicknode.com/agents/base-sepolia/9223">quicknode ↗</a></td>
              </tr>
              <tr>
                <td style={td} className="mono">treasury-agent</td>
                <td style={td}><span style={addr}>84532:9224</span> · feedback 90/100</td>
                <td style={td} className="mono"><a className="link" href="https://erc-8004.quicknode.com/agents/base-sepolia/9224">quicknode ↗</a></td>
              </tr>
              <tr>
                <td style={td} className="mono">reader-agent</td>
                <td style={td}><span style={addr}>84532:9225</span> · feedback 92/100</td>
                <td style={td} className="mono"><a className="link" href="https://erc-8004.quicknode.com/agents/base-sepolia/9225">quicknode ↗</a></td>
              </tr>
              <tr>
                <td style={td} className="mono">lab-1 (borrowed mainnet,<br />real negative)</td>
                <td style={td}><span style={addr}>8453:74108</span> · rep ≈0.10 → always escalates</td>
                <td style={td} className="mono"><a className="link" href="https://thegraph.com/docs/en/subgraphs/existing-subgraphs/agent0/">subgraph ↗</a></td>
              </tr>
              <tr>
                <td style={td} className="mono">Hedera merchant<br />(X402_PAY_TO_ACCOUNT)</td>
                <td style={td}><span style={addr}>0.0.10482549</span> · public, receive-only, key discarded</td>
                <td style={td} className="mono"><a className="link" href="https://hashscan.io/testnet/account/0.0.10482549">hashscan ↗</a></td>
              </tr>
              <tr>
                <td style={td} className="mono">Hedera operator<br />(dev payment authority)</td>
                <td style={td}><span style={addr}>0.0.10481126</span> · EVM <span style={addr}>0xd682…73EE</span> (truncated in runbook — full address on mirror)</td>
                <td style={td} className="mono"><a className="link" href="https://hashscan.io/testnet/account/0.0.10481126">hashscan ↗</a></td>
              </tr>
              <tr>
                <td style={{ ...td, borderBottom: "none" }} className="mono">HCS anchor topic<br />(HCS_TOPIC_ID)</td>
                <td style={{ ...td, borderBottom: "none" }}><span style={addr}>0.0.10517868</span> · fingerprints only, warn-only on failure</td>
                <td style={{ ...td, borderBottom: "none" }} className="mono"><a className="link" href="https://hashscan.io/testnet/topic/0.0.10517868">hashscan ↗</a></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mono" style={{ marginTop: 12, fontSize: 11, lineHeight: 1.8, color: "#5a5a5a" }}>
          FACILITATOR api.testnet.blocky402.com · RPC sepolia.base.org · FAUCET portal.hedera.com · SCAN PRICE $0.25 ≈ 3.3 HBAR · NO NEW SOLIDITY CONTRACTS IN THE MVP (FOUNDARY SCAFFOLD UNTOUCHED)
        </p>

        <SectionNum n="10" title="Demo tenant: Acme" />
        <p style={body}>
          Acme is a fictional 120-person fintech (invoicing SaaS, GitHub monolith + onchain
          USDC/ETH treasury) invented so the demo story, script, and transcript describe the same
          imaginary customer. Repos, PRs, secrets, deploys, and quotes are simulated and labeled
          on screen. What is real: the authorization pipeline every fictional action passes
          through, the ERC-8004 identities, the HBAR settlements, the wallet-signed approvals,
          and the HCS anchors. Cast: deploy-agent (ship code) · treasury-agent (move money) ·
          reader-agent (reads only) · lab-1 (unproven contractor, supervised). Each pilot incident
          maps to a beat: injected .env read → DENY · over-budget scan → DENY · cross-task read →
          DENY · low-rep read → ESCALATE · merge/deploy → ESCALATE → approve → execute.
        </p>

        <SectionNum n="11" title="Integration surface" />
        <p style={body}>
          Agents reach the gateway over standard MCP (five tools via our MCP server + official SDK
          client) or plain HTTPS tool-call routes. Console: agents, tasks, policies, approvals,
          payments, audit traces, network stream (SSE). Trust reads: live Agent0 subgraph with
          offline fixture fallback. Payments: x402 challenge → budget policy → Blocky402 settle →
          mirror-verified report. Approvals: pending queue → wallet sign → resolve → capability.
          Anchors: per-event fingerprint → HCS topic → verify page.
        </p>

        <SectionNum n="12" title="Security properties" />
        <p style={body}>
          The model drafts, the policy decides — the LLM is never the ALLOW/DENY oracle.
          Capabilities are single-action, single-resource, five-minute, policy-bound. Agents hold
          budget scopes, never payment keys. Settlements are merchant-verified fail-closed against
          the mirror node; replays, expiries, and tampered nonces are rejected. Private tenant data
          (prompts, arguments, secrets) stays offchain; only identity, reputation, attestations,
          payments, and fingerprint anchors touch the chain. Dev/mock surfaces are always labeled;
          a simulator is never presented as hardware security.
        </p>

        <SectionNum n="13" title="Run it yourself" />
        <div style={codeBlock}>{`pnpm install && pnpm db:migrate && pnpm dev   # :3000
curl -X POST localhost:3000/api/demo/seed   # fresh Acme tenant
open localhost:3000/demo/chat               # press PLAY
# env (app/.env.local, never committed):
DATABASE_URL=…  HEDERA_NETWORK=testnet
HEDERA_OPERATOR_ID=0.0.x  HEDERA_OPERATOR_KEY=SECRET
X402_PAY_TO_ACCOUNT=0.0.10482549  AGENT0_SUBGRAPH_URL=…
HCS_TOPIC_ID=… (pnpm --filter app hcs:init)`}</div>

        <SectionNum n="14" title="Sources" />
        <div className="mono" style={{ marginTop: 14, fontSize: 12.5, lineHeight: 2.1 }}>
          <div><a className="link" href="https://ethglobal.com/events/ethonline2026/prizes">ETHOnline 2026 prizes ↗</a></div>
          <div><a className="link" href="https://thegraph.com/docs/en/subgraphs/existing-subgraphs/agent0/">Agent0 / ERC-8004 subgraphs ↗</a></div>
          <div><a className="link" href="https://thegraph.com/docs/en/subgraphs/tooling/subgraph-mcp/introduction/">Subgraph MCP ↗</a></div>
          <div><a className="link" href="https://developers.ledger.com/docs/ai-tools/ledger-cli">Ledger wallet-cli / Key Ring ↗</a></div>
          <div><a className="link" href="https://eips.ethereum.org/EIPS/eip-8004">EIP-8004 ↗</a></div>
          <div><a className="link" href="https://ethglobal.com/events/ethonline2026/prizes/ens">ENS ETHOnline ↗</a></div>
        </div>

        <p className="mono" style={{ marginTop: 56, fontSize: 11, letterSpacing: "0.16em", color: "#5a5a5a" }}>
          □ CUBIC — MCP GIVES AGENTS TOOLS. ERC-8004 GIVES THEM IDENTITY. WE DECIDE WHAT THEY MAY DO.
        </p>
      </div>

      <SiteFooter />
    </main>
  );
}
