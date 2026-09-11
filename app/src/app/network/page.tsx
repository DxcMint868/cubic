"use client";

import { useState } from "react";
import AgentGraph from "@/components/AgentGraph";
import MacWindow from "@/components/MacWindow";
import SiteHeader from "@/components/SiteHeader";
import { MOCK_AGENTS } from "@/data/agents";

const STATS = [
  { value: "12", label: "AGENTS ONLINE" },
  { value: "24,921", label: "INTENTS EVALUATED" },
  { value: "23,884", label: "AUTHORIZED" },
  { value: "123", label: "ESCALATED" },
];

function RepBar({ value }: { value: number }) {
  return (
    <div
      style={{
        height: 6,
        border: "1px solid #3a3a3a",
        position: "relative",
        marginTop: 8,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 1,
          width: `calc(${Math.round(value * 100)}% - 2px)`,
          background: "#e8e8e8",
        }}
      />
    </div>
  );
}

export default function NetworkPage() {
  const [selectedId, setSelectedId] = useState(MOCK_AGENTS[0].registryId);
  const selected = MOCK_AGENTS.find((a) => a.registryId === selectedId)!;

  return (
    <main
      style={{
        minHeight: "100dvh",
        background: "#000",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <SiteHeader active="NETWORK" />

      <div className="section-pad" style={{ paddingBottom: 0 }}>
        <p
          className="mono"
          style={{ fontSize: 11, letterSpacing: "0.2em", color: "#5a5a5a" }}
        >
          AGENT NETWORK
        </p>
        <h1
          style={{
            marginTop: 18,
            fontSize: "clamp(34px, 4.5vw, 64px)",
            fontWeight: 700,
            letterSpacing: "-0.02em",
            lineHeight: 1.1,
            color: "#f4f4f4",
          }}
        >
          Available agents.
        </h1>
        <p
          style={{
            marginTop: 16,
            fontSize: 15.5,
            lineHeight: 1.65,
            color: "#8a8a8a",
            maxWidth: 640,
          }}
        >
          Every square is an agent open to work. Select one to inspect its
          ERC-8004 registration, reputation, and authorization history.
        </p>
        <p
          className="mono"
          style={{
            marginTop: 14,
            fontSize: 9.5,
            letterSpacing: "0.16em",
            color: "#3f3f3f",
          }}
        >
          SIMULATED ACTIVITY — DEMO NETWORK · SOURCE: MOCK — ERC-8004 WIRING
          PENDING
        </p>

        <div
          style={{
            marginTop: 30,
            paddingTop: 22,
            borderTop: "1px solid rgba(255,255,255,0.1)",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))",
            gap: "22px 28px",
            maxWidth: 640,
          }}
        >
          {STATS.map((s) => (
            <div key={s.label}>
              <div
                className="mono"
                style={{
                  fontSize: 19,
                  color: "#e8e8e8",
                  letterSpacing: "0.02em",
                }}
              >
                {s.value}
              </div>
              <div
                className="mono"
                style={{
                  marginTop: 6,
                  fontSize: 9.5,
                  letterSpacing: "0.16em",
                  color: "#5a5a5a",
                }}
              >
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="section-pad network-grid">
        <MacWindow title={`LIVE TOPOLOGY — ${MOCK_AGENTS.length} AGENTS`}>
          <div style={{ height: 480 }}>
            <AgentGraph
              agents={MOCK_AGENTS}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </div>
        </MacWindow>

        <MacWindow title={`AGENT #${selected.registryId}`}>
          <div style={{ padding: "28px 26px 30px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 30,
                  height: 30,
                  border: "1px solid #e8e8e8",
                  position: "relative",
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    inset: 11,
                    background: "#e8e8e8",
                  }}
                />
              </span>
              <div>
                <div
                  style={{
                    fontSize: 20,
                    fontWeight: 700,
                    letterSpacing: "-0.01em",
                    color: "#e8e8e8",
                  }}
                >
                  {selected.name}
                </div>
                <div
                  className="mono"
                  style={{
                    marginTop: 4,
                    fontSize: 11,
                    letterSpacing: "0.08em",
                    color: "#5a5a5a",
                  }}
                >
                  {selected.agentKey} · {selected.status.toUpperCase()}
                </div>
              </div>
            </div>

            <div
              className="mono"
              style={{
                marginTop: 22,
                fontSize: 11,
                letterSpacing: "0.14em",
                color: "#6a6a6a",
              }}
            >
              REPUTATION — {selected.reputation.toFixed(2)}
            </div>
            <RepBar value={selected.reputation} />

            <div
              style={{
                marginTop: 22,
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 16,
              }}
            >
              {[
                { v: selected.authorizations.toLocaleString(), l: "AUTHORIZED" },
                { v: String(selected.escalated), l: "ESCALATED" },
                { v: String(selected.denied), l: "DENIED" },
              ].map((s) => (
                <div key={s.l}>
                  <div
                    className="mono"
                    style={{ fontSize: 17, color: "#e8e8e8" }}
                  >
                    {s.v}
                  </div>
                  <div
                    className="mono"
                    style={{
                      marginTop: 5,
                      fontSize: 9,
                      letterSpacing: "0.16em",
                      color: "#5a5a5a",
                    }}
                  >
                    {s.l}
                  </div>
                </div>
              ))}
            </div>

            <dl
              className="mono"
              style={{
                marginTop: 24,
                borderTop: "1px solid rgba(255,255,255,0.1)",
                paddingTop: 18,
                display: "grid",
                gap: 10,
                fontSize: 11,
                letterSpacing: "0.06em",
              }}
            >
              {[
                ["REGISTRY ID", `#${selected.registryId}`],
                ["ENS", selected.ens ?? "—"],
                ["OWNER", selected.owner],
                ["CHAIN", selected.chain.toUpperCase()],
                ["LAST SEEN", selected.lastSeen.toUpperCase()],
              ].map(([k, v]) => (
                <div
                  key={k}
                  style={{ display: "flex", justifyContent: "space-between", gap: 16 }}
                >
                  <dt style={{ color: "#5a5a5a" }}>{k}</dt>
                  <dd style={{ color: "#c9c9c9", textAlign: "right" }}>{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </MacWindow>
      </div>

      <div className="section-pad" style={{ paddingTop: 0 }}>
        <p
          className="mono"
          style={{ fontSize: 11, letterSpacing: "0.2em", color: "#5a5a5a" }}
        >
          DIRECTORY
        </p>
        <div className="agent-grid">
          {MOCK_AGENTS.map((a) => {
            const active = a.registryId === selectedId;
            const size = 12 + a.reputation * 12;
            return (
              <button
                key={a.registryId}
                onClick={() => setSelectedId(a.registryId)}
                className="mono"
                style={{
                  cursor: "pointer",
                  textAlign: "left",
                  background: active ? "#0d0d0d" : "#000",
                  border: active ? "1px solid #e8e8e8" : "1px solid #232323",
                  borderRadius: 10,
                  padding: "18px 18px 16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                  color: "inherit",
                  fontFamily: "inherit",
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: size,
                    height: size,
                    border: `1px solid ${active ? "#fff" : "#8a8a8a"}`,
                    position: "relative",
                    flexShrink: 0,
                  }}
                >
                  {active && (
                    <span
                      style={{
                        position: "absolute",
                        inset: size / 2 - 2,
                        background: "#fff",
                      }}
                    />
                  )}
                </span>
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: "#e8e8e8",
                    fontFamily: "var(--font-sans, inherit)",
                    letterSpacing: "-0.01em",
                  }}
                >
                  {a.name}
                </span>
                <span style={{ fontSize: 10, letterSpacing: "0.1em", color: "#5a5a5a" }}>
                  #{a.registryId} · {a.status.toUpperCase()}
                </span>
                <span
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 10,
                    letterSpacing: "0.1em",
                    color: "#8a8a8a",
                    borderTop: "1px solid rgba(255,255,255,0.08)",
                    paddingTop: 10,
                  }}
                >
                  <span>REP {a.reputation.toFixed(2)}</span>
                  <span>{a.authorizations.toLocaleString()} AUTHS</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <footer className="mono site-footer">
        <span>© 2026 CUBIC</span>
        <nav>
          {["GITHUB", "DOCS", "CONTACT"].map((item) => (
            <a key={item} href="#" className="link">
              {item}
            </a>
          ))}
        </nav>
        <span className="footer-tag">AGENT AUTHORIZATION GATEWAY</span>
      </footer>
    </main>
  );
}
