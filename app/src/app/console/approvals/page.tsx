"use client";

import { useState } from "react";
import { APPROVALS } from "@/data/console";
import { PageHead, Panel } from "@/components/ConsoleBits";

export default function ConsoleApprovals() {
  const [queue, setQueue] = useState(APPROVALS);
  const [done, setDone] = useState<string[]>([]);

  const resolve = (id: string, verdict: string) => {
    setQueue((q) => q.filter((a) => a.id !== id));
    setDone((d) => [`${id} → ${verdict}`, ...d]);
  };

  return (
    <div>
      <PageHead
        eyebrow="CONSOLE — APPROVALS"
        title="High-risk queue."
        sub="Everything the policy escalated. Hardware-marked rows need Ledger approval before a capability is issued. Mock actions for now."
      />
      <div style={{ marginTop: 28, display: "grid", gap: 16 }}>
        {queue.map((a) => (
          <Panel key={a.id} title={`${a.id.toUpperCase()} — ${a.risk}`}>
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#f4f4f4" }}>
                {a.action}
              </div>
              <div className="mono" style={{ fontSize: 12, color: "#8a8a8a" }}>
                {a.resource} · {a.agent} · {a.age} AGO
              </div>
              <div className="mono" style={{ fontSize: 12, color: "#5a5a5a" }}>
                {a.context.toUpperCase()}
                {a.hardware && " · LEDGER HARDWARE REQUIRED"}
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
                <button
                  onClick={() => resolve(a.id, "APPROVED")}
                  className="mono"
                  style={{
                    cursor: "pointer",
                    fontSize: 10,
                    letterSpacing: "0.14em",
                    padding: "9px 18px",
                    background: "#e8e8e8",
                    border: "1px solid #e8e8e8",
                    color: "#000",
                  }}
                >
                  APPROVE
                </button>
                <button
                  onClick={() => resolve(a.id, "DENIED")}
                  className="mono btn-outline"
                  style={{ cursor: "pointer", background: "transparent" }}
                >
                  DENY
                </button>
              </div>
            </div>
          </Panel>
        ))}
        {queue.length === 0 && (
          <Panel title="QUEUE CLEAR">
            <p style={{ fontSize: 14, color: "#8a8a8a" }}>
              Nothing awaiting approval. Escalations will land here.
            </p>
          </Panel>
        )}
        {done.length > 0 && (
          <Panel title="RESOLVED THIS SESSION">
            <div className="mono" style={{ display: "grid", gap: 8, fontSize: 12, color: "#8a8a8a" }}>
              {done.map((d) => (
                <div key={d}>{d}</div>
              ))}
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}
