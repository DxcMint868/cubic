"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import MacWindow from "@/components/MacWindow";
import NetworkGraph from "@/components/network/NetworkGraph";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import {
  getNetworkEvents,
  getNetworkStats,
  mergeNetworkEvents,
  useApi,
  useNetworkStream,
  type NetworkEvent,
} from "@/lib/api";
import { fmtAge, fmtTime } from "@/components/console/derive";

const STATE_LEGEND = [
  { label: "CORE FILLED — ALLOWED", border: "1px solid #c9c9c9", core: true, dash: false },
  { label: "CORE HOLLOW — ESCALATED", border: "1px solid #8a8a8a", core: false, dash: false },
  { label: "DASHED — DENIED / REJECTED", border: "1px dashed #8a8a8a", core: false, dash: true },
];

const ACTION_LEGEND = [
  { label: "INTENT · DOTTED", stroke: "dotted" },
  { label: "EVALUATION · SOLID", stroke: "solid" },
  { label: "AUTHORIZATION · SOLID 2PX", stroke: "solid" },
  { label: "EXECUTION · BOLD", stroke: "solid" },
  { label: "APPROVAL · LONG DASH", stroke: "dashed" },
  { label: "TASK · HAIRLINE", stroke: "dotted" },
  { label: "PAYMENT · ◆ MARKER", stroke: "solid" },
];

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="mono" style={{ fontSize: 19, color: "#e8e8e8", letterSpacing: "0.02em" }}>
        {value}
      </div>
      <div
        className="mono"
        style={{ marginTop: 6, fontSize: 9.5, letterSpacing: "0.16em", color: "#5a5a5a" }}
      >
        {label}
      </div>
    </div>
  );
}

function OutcomeTag({ outcome }: { outcome: string }) {
  const filled = ["allow", "issued", "completed", "consumed", "succeeded", "created"].includes(outcome);
  const dashed = ["deny", "denied", "rejected", "failed", "not_found", "replay", "expired"].includes(outcome);
  return (
    <span
      className="mono"
      style={{
        display: "inline-block",
        fontSize: 9,
        letterSpacing: "0.12em",
        padding: "3px 7px",
        border: `1px ${dashed ? "dashed" : "solid"} #3a3a3a`,
        background: filled ? "#e8e8e8" : "transparent",
        color: filled ? "#000" : "#c9c9c9",
        whiteSpace: "nowrap",
      }}
    >
      {outcome.toUpperCase()}
    </span>
  );
}

export default function NetworkPage() {
  const initial = useApi("network-events", () => getNetworkEvents({ limit: 150 }));
  const stats = useApi("network-stats", getNetworkStats);
  const { events: live, connected, error: streamError } = useNetworkStream();
  const [selected, setSelected] = useState<string | null>(null);

  const events = useMemo(
    () => mergeNetworkEvents(initial.data ?? [], live),
    [initial.data, live],
  );

  const statsReload = stats.reload;
  const lastRefresh = useRef(0);
  useEffect(() => {
    if (live.length === 0) return;
    const now = Date.now();
    if (now - lastRefresh.current < 1500) return;
    lastRefresh.current = now;
    statsReload();
  }, [live.length, statsReload]);

  const agents = useMemo(() => {
    const map = new Map<
      string,
      { pseudonym: string; category: string; count: number; last: NetworkEvent }
    >();
    for (const event of events) {
      const current = map.get(event.agent_pseudonym);
      if (!current) {
        map.set(event.agent_pseudonym, {
          pseudonym: event.agent_pseudonym,
          category: event.agent_category,
          count: 1,
          last: event,
        });
      } else {
        current.count += 1;
        current.last = event;
        current.category = event.agent_category || current.category;
      }
    }
    return [...map.values()].sort((a, b) => b.last.id - a.last.id);
  }, [events]);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const agent of agents) counts.set(agent.category, (counts.get(agent.category) ?? 0) + 1);
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [agents]);

  const selectedAgent = selected ? agents.find((agent) => agent.pseudonym === selected) ?? null : null;
  const selectedEvents = useMemo(
    () =>
      selected
        ? events.filter((event) => event.agent_pseudonym === selected).slice(-10).reverse()
        : [],
    [events, selected],
  );
  const feed = useMemo(() => [...events].slice(-14).reverse(), [events]);

  const counters = stats.data;

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
        <p className="mono" style={{ fontSize: 11, letterSpacing: "0.2em", color: "#5a5a5a" }}>
          GLOBAL AGENT NETWORK
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
          Live agent activity.
        </h1>
        <p
          style={{
            marginTop: 16,
            fontSize: 15.5,
            lineHeight: 1.65,
            color: "#8a8a8a",
            maxWidth: 680,
          }}
        >
          Every cube is an agent pseudonym, grouped by its tool category. Pulses are real
          projected events from the gateway pipeline — decisions, capabilities, payments,
          executions — stripped of tenant identity before they reach this surface.
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
          {connected ? "SSE LIVE — SUBSCRIBED" : streamError?.toUpperCase() ?? "SSE — CONNECTING"}
          {" · REAL EVENT PIPELINE — SYNTHETIC SWARM AGENTS INCLUDED (DEMO)"}
        </p>

        <div
          style={{
            marginTop: 30,
            paddingTop: 22,
            borderTop: "1px solid rgba(255,255,255,0.1)",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))",
            gap: "22px 28px",
            maxWidth: 760,
          }}
        >
          <Stat value={counters ? String(counters.agents_observed) : "—"} label="AGENTS OBSERVED" />
          <Stat value={counters ? String(counters.intents_evaluated) : "—"} label="INTENTS EVALUATED" />
          <Stat value={counters ? String(counters.allowed) : "—"} label="ALLOWED" />
          <Stat value={counters ? String(counters.denied) : "—"} label="DENIED" />
          <Stat value={counters ? String(counters.escalated) : "—"} label="ESCALATED" />
          <Stat
            value={counters ? String(counters.payments_completed) : "—"}
            label="PAYMENTS COMPLETED"
          />
        </div>
      </div>

      {initial.error && !initial.data && events.length === 0 ? (
        <div className="section-pad" style={{ paddingTop: 28, paddingBottom: 0 }}>
          <MacWindow title="NETWORK — ERROR">
            <div style={{ padding: "26px 24px 28px" }}>
              <div
                className="mono"
                style={{ fontSize: 11, letterSpacing: "0.16em", color: "#e8e8e8" }}
              >
                {initial.error.code}
              </div>
              <p style={{ marginTop: 10, fontSize: 14, color: "#8a8a8a" }}>{initial.error.message}</p>
            </div>
          </MacWindow>
        </div>
      ) : (
        <div className="section-pad network-grid">
          <MacWindow title={`LIVE TOPOLOGY — ${agents.length} AGENTS`}>
            <div style={{ height: 520, position: "relative" }}>
              {initial.loading && events.length === 0 ? (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    padding: "26px 24px",
                    display: "grid",
                    gap: 14,
                    alignContent: "center",
                  }}
                >
                  <div className="mono" style={{ fontSize: 10, letterSpacing: "0.16em", color: "#3f3f3f" }}>
                    LOADING NETWORK EVENTS…
                  </div>
                  {[0, 1, 2].map((row) => (
                    <div
                      key={row}
                      aria-hidden
                      style={{
                        height: 16,
                        width: `${70 - row * 14}%`,
                        background: "#141414",
                        animation: "blink 1.6s steps(2, start) infinite",
                      }}
                    />
                  ))}
                </div>
              ) : events.length === 0 ? (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: 24,
                  }}
                >
                  <p
                    className="mono"
                    style={{
                      fontSize: 11,
                      letterSpacing: "0.14em",
                      color: "#5a5a5a",
                      textAlign: "center",
                    }}
                  >
                    No live events yet — run the demo agent or the swarm.
                  </p>
                </div>
              ) : (
                <NetworkGraph events={events} selected={selected} onSelect={setSelected} />
              )}
            </div>
          </MacWindow>

          <MacWindow
            title={
              selectedAgent
                ? `AGENT — ${selectedAgent.pseudonym.slice(0, 12)}`
                : "AGENT — SELECT A CUBE"
            }
          >
            <div style={{ padding: "24px 24px 26px" }}>
              {selectedAgent ? (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <span
                      aria-hidden
                      style={{
                        width: 28,
                        height: 28,
                        border: "1px solid #e8e8e8",
                        position: "relative",
                        flexShrink: 0,
                      }}
                    >
                      <span style={{ position: "absolute", inset: 10, background: "#e8e8e8" }} />
                    </span>
                    <div>
                      <div
                        className="mono"
                        style={{ fontSize: 15, color: "#f4f4f4", letterSpacing: "0.06em" }}
                      >
                        #{selectedAgent.pseudonym}
                      </div>
                      <div
                        className="mono"
                        style={{
                          marginTop: 5,
                          fontSize: 10,
                          letterSpacing: "0.16em",
                          color: "#5a5a5a",
                        }}
                      >
                        CATEGORY {selectedAgent.category.toUpperCase()} · LAST SEEN{" "}
                        {fmtAge(selectedAgent.last.created_at).toUpperCase()} AGO
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      marginTop: 24,
                      display: "grid",
                      gridTemplateColumns: "repeat(3, 1fr)",
                      gap: 16,
                    }}
                  >
                    {[
                      { value: String(selectedAgent.count), label: "EVENTS" },
                      { value: fmtTime(selectedAgent.last.created_at), label: "LAST EVENT" },
                      {
                        value: selectedAgent.last.risk_class.toUpperCase(),
                        label: "LAST RISK",
                      },
                    ].map((item) => (
                      <div key={item.label}>
                        <div className="mono" style={{ fontSize: 15, color: "#e8e8e8" }}>
                          {item.value}
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
                          {item.label}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div
                    className="mono"
                    style={{
                      marginTop: 24,
                      borderTop: "1px solid rgba(255,255,255,0.1)",
                      paddingTop: 16,
                      display: "grid",
                      gap: 10,
                    }}
                  >
                    {selectedEvents.map((event) => (
                      <div
                        key={event.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 12,
                          fontSize: 10,
                          letterSpacing: "0.06em",
                        }}
                      >
                        <span style={{ color: "#5a5a5a" }}>{fmtTime(event.created_at)}</span>
                        <span style={{ color: "#c9c9c9", flex: 1, minWidth: 0 }}>
                          {event.event_type}
                        </span>
                        <OutcomeTag outcome={event.outcome} />
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gap: 22,
                  }}
                >
                  <p style={{ fontSize: 14, lineHeight: 1.65, color: "#8a8a8a" }}>
                    Select a cube to inspect its category, event count, risk, and recent
                    projected activity. The public surface never shows tool arguments,
                    resources, prompts, or tenant identity.
                  </p>
                  <div className="mono" style={{ display: "grid", gap: 10 }}>
                    {categories.map(([category, count]) => (
                      <div
                        key={category}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: 10,
                          letterSpacing: "0.14em",
                          color: "#8a8a8a",
                        }}
                      >
                        <span>{category.toUpperCase()}</span>
                        <span style={{ color: "#e8e8e8" }}>{count}</span>
                      </div>
                    ))}
                    {categories.length === 0 && (
                      <span style={{ fontSize: 10, letterSpacing: "0.14em", color: "#3f3f3f" }}>
                        NO CATEGORIES OBSERVED
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </MacWindow>
        </div>
      )}

      <div className="section-pad" style={{ paddingTop: 0 }}>
        <div className="network-grid">
          <MacWindow title="EVENT STREAM — NEWEST FIRST">
            <div style={{ padding: "20px 24px 24px" }}>
              {feed.length === 0 ? (
                <p
                  className="mono"
                  style={{ fontSize: 11, letterSpacing: "0.14em", color: "#5a5a5a" }}
                >
                  No live events yet — run the demo agent or the swarm.
                </p>
              ) : (
                <div style={{ display: "grid", gap: 12 }}>
                  {feed.map((event) => (
                    <div
                      key={event.id}
                      className="mono"
                      style={{
                        display: "grid",
                        gridTemplateColumns: "54px 1fr auto",
                        alignItems: "center",
                        gap: 12,
                        fontSize: 10,
                        letterSpacing: "0.06em",
                      }}
                    >
                      <span style={{ color: "#5a5a5a" }}>{fmtTime(event.created_at)}</span>
                      <span style={{ color: "#c9c9c9", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {event.event_type}
                        <span style={{ color: "#3f3f3f" }}>
                          {" · "}
                          {event.agent_category} · #{event.agent_pseudonym.slice(0, 6)} ·{" "}
                          {event.risk_class}
                        </span>
                      </span>
                      <OutcomeTag outcome={event.outcome} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </MacWindow>

          <MacWindow title="LEGEND">
            <div style={{ padding: "20px 24px 24px" }}>
              <div className="mono" style={{ display: "grid", gap: 12, fontSize: 10, letterSpacing: "0.1em" }}>
                {STATE_LEGEND.map((item) => (
                  <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span
                      aria-hidden
                      style={{
                        width: 12,
                        height: 12,
                        border: item.border,
                        position: "relative",
                        flexShrink: 0,
                      }}
                    >
                      {item.core && (
                        <span style={{ position: "absolute", inset: 3, background: "#e8e8e8" }} />
                      )}
                    </span>
                    <span style={{ color: "#8a8a8a" }}>{item.label}</span>
                  </div>
                ))}
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span
                    aria-hidden
                    style={{
                      width: 10,
                      height: 10,
                      border: "1px solid #e8e8e8",
                      transform: "rotate(45deg)",
                      marginLeft: 1,
                      marginRight: 1,
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ color: "#8a8a8a" }}>PAYMENT — TRANSACTION MARKER</span>
                </div>
                <div style={{ height: 1, background: "rgba(255,255,255,0.1)" }} />
                {ACTION_LEGEND.map((item) => (
                  <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span
                      aria-hidden
                      style={{
                        width: 26,
                        height: 0,
                        borderTop: `2px ${item.stroke} ${
                          item.stroke === "dotted" ? "#8a8a8a" : "#e8e8e8"
                        }`,
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ color: "#8a8a8a" }}>{item.label}</span>
                  </div>
                ))}
                <div style={{ height: 1, background: "rgba(255,255,255,0.1)" }} />
                <span style={{ color: "#5a5a5a" }}>
                  COUNTERS — AGGREGATES OVER ALL PROJECTED EVENTS
                </span>
              </div>
            </div>
          </MacWindow>
        </div>
      </div>

      <SiteFooter />
    </main>
  );
}
