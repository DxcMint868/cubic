import { MOCK_AGENTS } from "@/data/console";
import { PageHead, Panel, td, th } from "@/components/ConsoleBits";

const CAPS: Record<string, string> = {
  "deploy-agent": "github.merge · deploy.prod",
  "review-bot": "github.read · ci.inspect",
  "pay-runner": "x402.pay · treasury.read",
  "scan-seeker": "x402.pay · scanner.use",
  "ci-herald": "slack.post · ci.read",
  "a2a-relay": "a2a.route · graph.query",
};

export default function ConsoleAgents() {
  const agents = MOCK_AGENTS.slice(0, 6);
  return (
    <div>
      <PageHead
        eyebrow="CONSOLE — AGENTS"
        title="Agents you authorize."
        sub="Tenant-scoped registry. Global discovery lives on the network page — here you decide what each agent may do."
      />
      <div style={{ marginTop: 28 }}>
        <Panel title={`${agents.length} AGENTS`}>
          <div style={{ overflowX: "auto" }}>
            <table className="mono" style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>AGENT</th>
                  <th style={th}>REGISTRY</th>
                  <th style={th}>REPUTATION</th>
                  <th style={th}>DECLARED CAPS</th>
                  <th style={th}>AUTHS</th>
                  <th style={th}>STATUS</th>
                  <th style={th}>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => (
                  <tr key={a.registryId}>
                    <td style={td}>
                      <span style={{ color: "#f4f4f4" }}>{a.name}</span>
                    </td>
                    <td style={td}>#{a.registryId}</td>
                    <td style={td}>{a.reputation.toFixed(2)}</td>
                    <td style={{ ...td, fontSize: 12 }}>
                      {CAPS[a.name] ?? "github.read"}
                    </td>
                    <td style={td}>{a.authorizations.toLocaleString()}</td>
                    <td style={td}>{a.status.toUpperCase()}</td>
                    <td style={td}>
                      <span style={{ fontSize: 11, color: "#5a5a5a" }}>
                        PAUSE · ROTATE
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}
