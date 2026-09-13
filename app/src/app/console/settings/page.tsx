import { PageHead, Panel } from "@/components/ConsoleBits";

const ROWS: [string, string][] = [
  ["TENANT", "acme · TEAM"],
  ["SPEND DEFAULT", "$0.50 / TASK · ALLOWLISTED SERVICES ONLY"],
  ["APPROVAL MODE", "HARDWARE FOR HIGH-RISK · LEDGER KEY RING"],
  ["TRUST PROVIDER", "LEDGER KEY RING (DEV PATH UNTIL DEVICE PROVISIONED)"],
  ["GRAPH CONTEXT", "AGENT0 / ERC-8004 SUBGRAPHS · BASE SEPOLIA"],
];

export default function ConsoleSettings() {
  return (
    <div>
      <PageHead
        eyebrow="CONSOLE — SETTINGS"
        title="Tenant controls."
        sub="Budgets, approval modes, and trust providers. Mock controls — values persist once tenant config lands."
      />
      <div style={{ marginTop: 28 }}>
        <Panel title="CONFIGURATION">
          <div className="mono" style={{ display: "grid", gap: 14, fontSize: 12 }}>
            {ROWS.map(([k, v]) => (
              <div
                key={k}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 20,
                  borderTop: "1px solid rgba(255,255,255,0.07)",
                  paddingTop: 14,
                }}
              >
                <span style={{ color: "#5a5a5a", letterSpacing: "0.12em" }}>
                  {k}
                </span>
                <span style={{ color: "#c9c9c9", textAlign: "right" }}>{v}</span>
              </div>
            ))}
          </div>
          <button
            className="mono btn-outline"
            style={{ marginTop: 24, background: "transparent", cursor: "pointer" }}
          >
            SAVE
          </button>
        </Panel>
      </div>
    </div>
  );
}
