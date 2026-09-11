import { AUDIT } from "@/data/console";
import { DecisionTag, PageHead, Panel, td, th } from "@/components/ConsoleBits";

export default function ConsoleAudit() {
  return (
    <div>
      <PageHead
        eyebrow="CONSOLE — AUDIT"
        title="Intent to result."
        sub="The durable chain: intent → decision → capability → execution → result. Tenant-private — the network page only ever sees anonymized aggregates."
      />
      <div style={{ marginTop: 28 }}>
        <Panel title={`${AUDIT.length} EVENTS — TODAY`}>
          <div style={{ overflowX: "auto" }}>
            <table className="mono" style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>TIME</th>
                  <th style={th}>INTENT</th>
                  <th style={th}>AGENT</th>
                  <th style={th}>DECISION</th>
                  <th style={th}>CAPABILITY</th>
                  <th style={th}>RESULT</th>
                </tr>
              </thead>
              <tbody>
                {AUDIT.map((e) => (
                  <tr key={e.time + e.intent}>
                    <td style={td}>{e.time}</td>
                    <td style={{ ...td, minWidth: 180 }}>{e.intent}</td>
                    <td style={td}>{e.agent}</td>
                    <td style={td}>
                      <DecisionTag d={e.decision} />
                    </td>
                    <td style={{ ...td, fontSize: 12 }}>{e.capability}</td>
                    <td style={{ ...td, fontSize: 12 }}>{e.result}</td>
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
