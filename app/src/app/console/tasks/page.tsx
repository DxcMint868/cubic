import { TASKS } from "@/data/console";
import { PageHead, Panel, td, th } from "@/components/ConsoleBits";

export default function ConsoleTasks() {
  return (
    <div>
      <PageHead
        eyebrow="CONSOLE — TASKS"
        title="Tasks in flight."
        sub="Each task groups the intents an agent emitted while doing one job — and what the gateway decided about each."
      />
      <div style={{ marginTop: 28 }}>
        <Panel title={`${TASKS.length} TASKS`}>
          <div style={{ overflowX: "auto" }}>
            <table className="mono" style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>TASK</th>
                  <th style={th}>GOAL</th>
                  <th style={th}>AGENT</th>
                  <th style={th}>INTENTS</th>
                  <th style={th}>ALLOW / ESC / DENY</th>
                  <th style={th}>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {TASKS.map((t) => (
                  <tr key={t.id}>
                    <td style={td}>{t.id}</td>
                    <td style={{ ...td, minWidth: 220 }}>{t.goal}</td>
                    <td style={td}>{t.agent}</td>
                    <td style={td}>{t.intents}</td>
                    <td style={td}>
                      {t.allowed} / {t.escalated} / {t.denied}
                    </td>
                    <td style={td}>
                      <span
                        style={{
                          color:
                            t.status === "BLOCKED" ? "#f4f4f4" : "#c9c9c9",
                        }}
                      >
                        {t.status}
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
