"use client";

import { useState } from "react";
import AgentGraph from "@/components/AgentGraph";
import MacWindow from "@/components/MacWindow";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import { MOCK_AGENTS } from "@/data/agents";
import type { Agent, AgentStatus } from "@/data/agents";

const tier = (r: number) =>
  r >= 0.9 ? "TRUSTED" : r >= 0.8 ? "ESTABLISHED" : r >= 0.7 ? "WATCH" : "PROBATION";

const MAX_AUTHS = Math.max(...MOCK_AGENTS.map((a) => a.authorizations));

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
  const [statusFilter, setStatusFilter] = useState<"ALL" | AgentStatus>("ALL");
  const [sortBy, setSortBy] = useState<"REP" | "AUTHS">("REP");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const selected = MOCK_AGENTS.find((a) => a.registryId === selectedId)!;

  const PAGE_SIZE = 8;
  const q = query.trim().toLowerCase();
  const filtered = MOCK_AGENTS.filter(
    (a) => statusFilter === "ALL" || a.status === statusFilter
  )
    .filter(
      (a) =>
        !q ||
        String(a.registryId).includes(q) ||
        a.name.toLowerCase().includes(q) ||
        a.agentKey.toLowerCase().includes(q) ||
        (a.ens ?? "").toLowerCase().includes(q)
    )
    .sort((a, b) =>
      sortBy === "REP"
        ? b.reputation - a.reputation
        : b.authorizations - a.authorizations
    );
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const cur = Math.min(page, pages - 1);
  const slice = filtered.slice(cur * PAGE_SIZE, (cur + 1) * PAGE_SIZE);

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
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 16,
          }}
        >
          <p
            className="mono"
            style={{ fontSize: 11, letterSpacing: "0.2em", color: "#5a5a5a" }}
          >
            DIRECTORY — {filtered.length}
          </p>
          <div className="mono" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {(["ALL", "online", "idle", "offline"] as const).map((s) => (
              <button
                key={s}
                onClick={() => {
                  setStatusFilter(s);
                  setPage(0);
                }}
                style={{
                  cursor: "pointer",
                  fontSize: 10,
                  letterSpacing: "0.14em",
                  padding: "6px 12px",
                  border: "1px solid #3a3a3a",
                  background: statusFilter === s ? "#e8e8e8" : "transparent",
                  color: statusFilter === s ? "#000" : "#8a8a8a",
                  fontFamily: "inherit",
                }}
              >
                {s === "ALL" ? "ALL" : s.toUpperCase()}
              </button>
            ))}
            <span style={{ width: 8 }} />
            {(["REP", "AUTHS"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSortBy(s)}
                style={{
                  cursor: "pointer",
                  fontSize: 10,
                  letterSpacing: "0.14em",
                  padding: "6px 12px",
                  border: "1px solid transparent",
                  borderBottomColor: sortBy === s ? "#e8e8e8" : "transparent",
                  background: "transparent",
                  color: sortBy === s ? "#fff" : "#5a5a5a",
                  fontFamily: "inherit",
                }}
              >
                {s === "REP" ? "↓ REP" : "↓ AUTHS"}
              </button>
            ))}
          </div>
        </div>

        <div
          className="mono"
          style={{
            marginTop: 18,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 16,
          }}
        >
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            placeholder="SEARCH ID · NAME · ENS — e.g. 8472"
            aria-label="Search agents by id, name, or ENS"
            style={{
              background: "#000",
              border: "1px solid #2e2e2e",
              borderRadius: 8,
              padding: "10px 14px",
              color: "#e8e8e8",
              fontSize: 11,
              letterSpacing: "0.1em",
              fontFamily: "inherit",
              width: "min(340px, 100%)",
              outline: "none",
            }}
          />
          <div
            style={{
              display: "flex",
              gap: 20,
              fontSize: 9.5,
              letterSpacing: "0.14em",
              color: "#5a5a5a",
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span aria-hidden style={{ width: 10, height: 10, border: "1px solid #c9c9c9", position: "relative" }}>
                <span style={{ position: "absolute", inset: 3, background: "#5a5a5a" }} />
              </span>
              ONLINE — SOLID
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span aria-hidden style={{ width: 10, height: 10, border: "1px dashed #5a5a5a" }} />
              IDLE — DASHED
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span aria-hidden style={{ width: 10, height: 10, border: "1px solid #2e2e2e", opacity: 0.72 }} />
              OFFLINE — DIM
            </span>
          </div>
        </div>

        <div className="agent-grid">
          {slice.map((a) => {
              const active = a.registryId === selectedId;
              const size = 14 + a.reputation * 14;
              const border = active
                ? "#e8e8e8"
                : a.status === "online"
                  ? "#3a3a3a"
                  : "#232323";
              return (
                <button
                  key={a.registryId}
                  onClick={() => setSelectedId(a.registryId)}
                  className="mono"
                  style={{
                    cursor: "pointer",
                    textAlign: "left",
                    background: active ? "#0d0d0d" : "#000",
                    border: `1px ${a.status === "idle" && !active ? "dashed" : "solid"} ${border}`,
                    borderRadius: 10,
                    padding: "20px 18px 18px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 0,
                    color: "inherit",
                    fontFamily: "inherit",
                    opacity: a.status === "offline" && !active ? 0.72 : 1,
                  }}
                >
                  <span
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: size,
                        height: size,
                        border: `1px solid ${active ? "#fff" : a.status === "online" ? "#c9c9c9" : "#5a5a5a"}`,
                        position: "relative",
                        flexShrink: 0,
                      }}
                    >
                      {(active || a.status === "online") && (
                        <span
                          style={{
                            position: "absolute",
                            inset: size / 2 - 2,
                            background: active ? "#fff" : "#5a5a5a",
                          }}
                        />
                      )}
                    </span>
                    <span
                      style={{
                        fontSize: 9,
                        letterSpacing: "0.16em",
                        padding: "4px 8px",
                        border: "1px solid #2e2e2e",
                        color: tier(a.reputation) === "TRUSTED" ? "#e8e8e8" : "#5a5a5a",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {tier(a.reputation)}
                    </span>
                  </span>

                  <span
                    style={{
                      marginTop: 16,
                      fontSize: 16,
                      fontWeight: 700,
                      color: "#e8e8e8",
                      fontFamily: "var(--font-sans, inherit)",
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {a.name}
                  </span>
                  <span
                    style={{
                      marginTop: 4,
                      fontSize: 10,
                      letterSpacing: "0.08em",
                      color: "#5a5a5a",
                    }}
                  >
                    {a.agentKey} · {a.status.toUpperCase()}
                  </span>

                  <span style={{ marginTop: 16 }}>
                    <span
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 10,
                        letterSpacing: "0.12em",
                        color: "#8a8a8a",
                      }}
                    >
                      <span>REP {a.reputation.toFixed(2)}</span>
                      <span>{a.authorizations.toLocaleString()} AUTHS</span>
                    </span>
                    <span
                      aria-hidden
                      style={{
                        display: "block",
                        marginTop: 7,
                        height: 5,
                        border: "1px solid #2e2e2e",
                        position: "relative",
                      }}
                    >
                      <span
                        style={{
                          position: "absolute",
                          inset: 1,
                          width: `calc(${Math.round((a.reputation / 1) * 100)}% - 2px)`,
                          background: "#8a8a8a",
                        }}
                      />
                    </span>
                    <span
                      aria-hidden
                      style={{
                        display: "block",
                        marginTop: 5,
                        height: 5,
                        border: "1px solid #2e2e2e",
                        position: "relative",
                      }}
                    >
                      <span
                        style={{
                          position: "absolute",
                          inset: 1,
                          width: `calc(${Math.round((a.authorizations / MAX_AUTHS) * 100)}% - 2px)`,
                          background: "#3a3a3a",
                        }}
                      />
                    </span>
                  </span>

                  <span
                    style={{
                      marginTop: 14,
                      paddingTop: 12,
                      borderTop: "1px solid rgba(255,255,255,0.08)",
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 9.5,
                      letterSpacing: "0.1em",
                      color: "#5a5a5a",
                    }}
                  >
                    <span>
                      {a.chain.toUpperCase()} · {a.lastSeen.toUpperCase()}
                    </span>
                    <span>
                      {a.escalated} ESC · {a.denied} DEN
                    </span>
                  </span>
              </button>
            );
          })}
        </div>

        {slice.length === 0 && (
          <div
            className="mono"
            style={{
              marginTop: 20,
              border: "1px solid #232323",
              borderRadius: 10,
              padding: "34px 24px",
              textAlign: "center",
              fontSize: 11,
              letterSpacing: "0.14em",
              color: "#5a5a5a",
            }}
          >
            NO AGENTS MATCH “{query.trim().toUpperCase()}” — TRY ANOTHER ID, NAME, OR ENS.
          </div>
        )}

        <div
          className="mono"
          style={{
            marginTop: 22,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
            fontSize: 10,
            letterSpacing: "0.14em",
            color: "#5a5a5a",
          }}
        >
          <span>
            SHOWING{" "}
            {filtered.length === 0
              ? "0"
              : `${cur * PAGE_SIZE + 1}–${Math.min((cur + 1) * PAGE_SIZE, filtered.length)}`}{" "}
            OF {filtered.length}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={cur === 0}
              style={{
                cursor: cur === 0 ? "default" : "pointer",
                fontSize: 10,
                letterSpacing: "0.14em",
                padding: "8px 14px",
                border: "1px solid #2e2e2e",
                background: "transparent",
                color: cur === 0 ? "#2e2e2e" : "#c9c9c9",
                fontFamily: "inherit",
              }}
            >
              ← PREV
            </button>
            <span style={{ color: "#8a8a8a" }}>
              PAGE {cur + 1} / {pages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
              disabled={cur >= pages - 1}
              style={{
                cursor: cur >= pages - 1 ? "default" : "pointer",
                fontSize: 10,
                letterSpacing: "0.14em",
                padding: "8px 14px",
                border: "1px solid #2e2e2e",
                background: "transparent",
                color: cur >= pages - 1 ? "#2e2e2e" : "#c9c9c9",
                fontFamily: "inherit",
              }}
            >
              NEXT →
            </button>
          </span>
        </div>
      </div>

      <SiteFooter />
    </main>
  );
}
