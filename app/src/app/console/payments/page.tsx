import { PAYMENTS } from "@/data/console";
import { PageHead, Panel, td, th } from "@/components/ConsoleBits";

export default function ConsolePayments() {
  return (
    <div>
      <PageHead
        eyebrow="CONSOLE — PAYMENTS"
        title="Machine spend."
        sub="x402 invoices treated as intents: allowlisted service, per-task budget, reputation bar. Settled over Hedera via Blocky402."
      />
      <div style={{ marginTop: 28 }}>
        <Panel title="INVOICES — THIS WEEK">
          <div style={{ overflowX: "auto" }}>
            <table className="mono" style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>ID</th>
                  <th style={th}>SERVICE</th>
                  <th style={th}>AMOUNT</th>
                  <th style={th}>BUDGET</th>
                  <th style={th}>TASK</th>
                  <th style={th}>TX</th>
                  <th style={th}>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {PAYMENTS.map((p) => (
                  <tr key={p.id}>
                    <td style={td}>{p.id}</td>
                    <td style={td}>{p.service}</td>
                    <td style={td}>{p.amount}</td>
                    <td style={td}>{p.budget}</td>
                    <td style={td}>{p.task}</td>
                    <td style={td}>{p.tx}</td>
                    <td style={td}>{p.status}</td>
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
