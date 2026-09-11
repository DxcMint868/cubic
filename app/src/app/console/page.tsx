import { APPROVALS, AUDIT, OVERVIEW_STATS } from "@/data/console";
import { DecisionTag, PageHead, Panel, StatRow } from "@/components/ConsoleBits";

export default function ConsoleOverview() {
  return (
    <div>
      <PageHead
        eyebrow="CONSOLE — ACME · TEAM"
        title="Overview."
        sub="Tenant health at a glance. Mock figures — live gateway telemetry plugs in here."
      />
      <StatRow stats={OVERVIEW_STATS} />

      <div className="console-cards">
        <Panel title="PENDING APPROVALS — 3">
          <div style={{ display: "grid", gap: 14 }}>
            {APPROVALS.map((a) => (
              <div
                key={a.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 16,
                  fontSize: 13,
                  color: "#c9c9c9",
                }}
              >
                <span>
                  <span className="mono" style={{ color: "#5a5a5a", fontSize: 11 }}>
                    {a.id} ·{" "}
                  </span>
                  {a.action} — {a.resource}
                </span>
                <span
                  className="mono"
                  style={{ fontSize: 10, letterSpacing: "0.12em", color: "#8a8a8a" }}
                >
                  {a.risk}
                </span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="RECENT DECISIONS">
          <div style={{ display: "grid", gap: 12 }}>
            {AUDIT.slice(0, 5).map((e) => (
              <div
                key={e.time + e.intent}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <span style={{ fontSize: 13, color: "#c9c9c9" }}>{e.intent}</span>
                <DecisionTag d={e.decision} />
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div style={{ marginTop: 24 }}>
        <Panel title="MACHINE SPEND — TODAY">
          <div
            className="mono"
            style={{ fontSize: 11, letterSpacing: "0.1em", color: "#8a8a8a" }}
          >
            $0.68 / $2.00 TASK BUDGETS
          </div>
          <div
            style={{
              marginTop: 10,
              height: 8,
              border: "1px solid #3a3a3a",
              position: "relative",
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 1,
                width: "calc(34% - 2px)",
                background: "#e8e8e8",
              }}
            />
          </div>
        </Panel>
      </div>
    </div>
  );
}
