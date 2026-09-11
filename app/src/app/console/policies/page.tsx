"use client";

import { useState } from "react";
import { POLICIES } from "@/data/console";
import { PageHead, Panel } from "@/components/ConsoleBits";

export default function ConsolePolicies() {
  const [on, setOn] = useState<Record<string, boolean>>(
    Object.fromEntries(POLICIES.map((p) => [p.id, p.enabled]))
  );

  return (
    <div>
      <PageHead
        eyebrow="CONSOLE — POLICIES"
        title="Deterministic rules."
        sub="The final ALLOW / DENY authority. LLMs may summarize intent — only these rules decide. Toggles are mock until the policy API lands."
      />
      <div style={{ marginTop: 28, display: "grid", gap: 16 }}>
        {POLICIES.map((p) => (
          <Panel key={p.id} title={`${p.name.toUpperCase()} — ${p.version}`}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 20,
                alignItems: "flex-start",
              }}
            >
              <div>
                <div
                  className="mono"
                  style={{ fontSize: 11, letterSpacing: "0.1em", color: "#5a5a5a" }}
                >
                  {p.scope.toUpperCase()} · {p.evaluated.toUpperCase()}
                </div>
                <p style={{ marginTop: 10, fontSize: 14, color: "#c9c9c9" }}>
                  {p.rules}
                </p>
              </div>
              <button
                onClick={() => setOn((s) => ({ ...s, [p.id]: !s[p.id] }))}
                className="mono"
                style={{
                  cursor: "pointer",
                  fontSize: 10,
                  letterSpacing: "0.14em",
                  padding: "8px 14px",
                  border: "1px solid #3a3a3a",
                  background: on[p.id] ? "#e8e8e8" : "transparent",
                  color: on[p.id] ? "#000" : "#8a8a8a",
                  whiteSpace: "nowrap",
                }}
              >
                {on[p.id] ? "ENABLED" : "PAUSED"}
              </button>
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}
