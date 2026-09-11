"use client";

// Gateway decision feed — the authorization layer made visible. A slow
// stream of intent → decision → capability lines inside window chrome:
// the one visual that makes "Cloudflare for agent actions" click.
// Mock script until live gateway telemetry exists.
import { useEffect, useRef, useState } from "react";
import MacWindow from "@/components/MacWindow";

type FeedEvent = {
  agent: string;
  action: string;
  decision: "ALLOW" | "DENY" | "ESCALATE";
  note: string;
};

type Line = { e: FeedEvent; time: Date; key: number };

const fmt = (d: Date) =>
  [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((v) => String(v).padStart(2, "0"))
    .join(":");

const SCRIPT: FeedEvent[] = [
  { agent: "deploy-agent", action: "github.get_pull_request #421", decision: "ALLOW", note: "cap 5m" },
  { agent: "scan-seeker", action: "x402.pay scanner-123 · $0.25", decision: "ALLOW", note: "settled · Hedera" },
  { agent: "deploy-agent", action: "github.merge_pull_request #421", decision: "ESCALATE", note: "Ledger approved → cap 5m" },
  { agent: "unknown-task", action: "read .env.production", decision: "DENY", note: "prompt-injection wall" },
  { agent: "ci-herald", action: "slack.post #eng-build", decision: "ALLOW", note: "cap 5m" },
  { agent: "pay-runner", action: "transfer 250 USDC", decision: "ESCALATE", note: "over auto-spend cap → pending" },
  { agent: "review-bot", action: "github.read diff #422", decision: "ALLOW", note: "cap 5m" },
];

const WINDOW = 5;
const TICK_MS = 2600;

function Tag({ d }: { d: FeedEvent["decision"] }) {
  const filled = d === "ALLOW";
  return (
    <span
      className="mono"
      style={{
        display: "inline-block",
        fontSize: 10,
        letterSpacing: "0.12em",
        padding: "3px 9px",
        border: "1px solid #3a3a3a",
        background: filled ? "#e8e8e8" : "transparent",
        color: filled ? "#000" : d === "DENY" ? "#f4f4f4" : "#c9c9c9",
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {d}
    </span>
  );
}

export default function DecisionFeed() {
  // Seeded on mount (client-only, so no SSR hydration mismatch) with
  // backdated stamps; every new line is stamped with the real local time
  // the moment it appears.
  const [lines, setLines] = useState<Line[]>([]);
  const [started, setStarted] = useState(false);
  const idx = useRef(0);

  useEffect(() => {
    const now = Date.now();
    const seed: Line[] = [0, 1].map((k) => ({
      e: SCRIPT[k % SCRIPT.length],
      time: new Date(now - (1 - k) * TICK_MS),
      key: k,
    }));
    idx.current = 2;
    setLines(seed);
    setStarted(true);
    const id = setInterval(() => {
      const k = idx.current++;
      setLines((prev) => [
        ...prev.slice(-(WINDOW - 1)),
        { e: SCRIPT[k % SCRIPT.length], time: new Date(), key: k },
      ]);
    }, TICK_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <section
      className="section-pad"
      style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}
    >
      <p
        className="mono"
        style={{ fontSize: 11, letterSpacing: "0.2em", color: "#5a5a5a" }}
      >
        THE GATEWAY
      </p>
      <h2
        style={{
          marginTop: 18,
          fontSize: "clamp(34px, 4.5vw, 64px)",
          fontWeight: 700,
          letterSpacing: "-0.02em",
          lineHeight: 1.1,
          color: "#f4f4f4",
          maxWidth: 800,
        }}
      >
        Every call, decided in the open.
      </h2>

      <div style={{ marginTop: "5vh", maxWidth: 880 }}>
        <MacWindow title="GATEWAY — LIVE DECISIONS">
          <div
            className="mono"
            style={{ padding: "22px 24px 24px", display: "grid", gap: 2 }}
          >
            {lines.map((l) => (
              <div
                key={l.key}
                className="feed-line"
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 12,
                  flexWrap: "wrap",
                  padding: "9px 0",
                  borderBottom: "1px solid rgba(255,255,255,0.06)",
                  fontSize: 12,
                }}
              >
                <span style={{ color: "#3f3f3f" }}>{fmt(l.time)}</span>
                <span style={{ color: "#8a8a8a" }}>{l.e.agent}</span>
                <span style={{ color: "#e8e8e8" }}>{l.e.action}</span>
                <span style={{ color: "#3f3f3f" }}>→</span>
                <Tag d={l.e.decision} />
                <span style={{ color: "#5a5a5a", fontSize: 11 }}>{l.e.note}</span>
              </div>
            ))}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                paddingTop: 14,
                fontSize: 11,
                letterSpacing: "0.12em",
                color: "#3f3f3f",
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 12,
                  background: "#5a5a5a",
                  animation: started ? "blink 1.2s steps(1) infinite" : "none",
                }}
              />
              SIMULATED FEED — DEMO NETWORK
            </div>
          </div>
        </MacWindow>
      </div>
    </section>
  );
}
