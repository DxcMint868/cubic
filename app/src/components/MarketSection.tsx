"use client";

// Market / "why now" section — concentric outlined squares (the Cubic
// motif, not circles) for TAM → SAM → SOM, plus a ledger of real,
// sourced agent-money incidents. TAM/SAM figures are analyst-anchored
// (links below); SOM is our estimate and labeled as such.
//
// Selection is click/tap-to-lock on purpose: hover only previews a ring
// so the readout (and its source link) never changes under your cursor
// while you move toward it.
import { useEffect, useRef, useState } from "react";

const RINGS = [
  {
    tag: "TAM",
    value: 52.6,
    size: 380,
    base: "#2e2e2e",
    hot: "#8a8a8a",
    desc: "Global AI agents market by 2030 — $7.84B (2025) at 46.3% CAGR.",
    src: "MarketsandMarkets",
    href: "https://www.marketsandmarkets.com/PressReleases/ai-agents.asp",
  },
  {
    tag: "SAM",
    value: 13.5,
    size: 250,
    base: "#5a5a5a",
    hot: "#c9c9c9",
    desc: "Agentic AI security market by 2032 — $1.65B (2026) at 42.0% CAGR.",
    src: "MarketsandMarkets",
    href: "https://www.marketsandmarkets.com/PressReleases/agentic-ai-security.asp",
  },
  {
    tag: "SOM",
    value: 1.5,
    size: 130,
    base: "#8a8a8a",
    hot: "#f4f4f4",
    desc: "Policy-enforced authorization for teams shipping agents to production.",
    src: "Cubic estimate",
    href: "#market",
  },
];

const LOSSES: { amount: string; what: string; href: string; src: string }[] = [
  {
    amount: "$441,000",
    what: "Trading bot misread a reply and donated its entire holdings.",
    href: "https://oecd.ai/en/incidents/2026-02-23-5c52",
    src: "OECD",
  },
  {
    amount: "$104,000",
    what: "AIXBT agent queued two malicious replies, tipped 55.5 ETH to an attacker.",
    href: "https://www.theblock.co/post/346911/ai-crypto-bot-aixbt-lost-eth-hack-unauthorized-dashboard-access",
    src: "The Block",
  },
  {
    amount: "$47,000",
    what: "Freysa prize pool drained when a transfer was reframed as allowed.",
    href: "https://www.aiaaic.org/aiaaic-repository/ai-algorithmic-and-automation-incidents/freysa-crypto-ai-agent-manipulated-to-reduce-prize-money-pool",
    src: "AIAAIC",
  },
  {
    amount: "$14,000",
    what: "One day of Bedrock spend after static agent keys were extracted.",
    href: "https://www.infoq.com/news/2026/07/ai-agents-billing-guardrails",
    src: "InfoQ",
  },
  {
    amount: "$6,531",
    what: "AWS bill in under a week from an agent handed full credentials.",
    href: "https://byteiota.com/ai-agent-racked-up-6531-in-aws-charges-overnight",
    src: "byteiota",
  },
];

function useCountUp(target: number, run: boolean, key: string) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!run) return;
    let raf = 0;
    const t0 = performance.now();
    const dur = 1100;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      setV(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, run, key]);
  return v;
}

export default function MarketSection() {
  const [visible, setVisible] = useState(false);
  const [active, setActive] = useState("SOM");
  const [hovered, setHovered] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -25% 0px", threshold: 0.1 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const ring = RINGS.find((r) => r.tag === active)!;
  const counted = useCountUp(ring.value, visible, active);

  return (
    <section
      id="market"
      ref={ref}
      className="section-pad"
      style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}
    >
      <p
        className="mono"
        style={{ fontSize: 11, letterSpacing: "0.2em", color: "#5a5a5a" }}
      >
        WHY NOW
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
        The bill for trusting agents is already due.
      </h2>

      <div className="market-grid">
        <div>
          <svg
            viewBox="0 0 400 400"
            role="group"
            aria-label="TAM 52.6 billion, SAM 13.5 billion, SOM 1.5 billion dollars. Select a square for detail."
            style={{ display: "block", width: "100%", height: "auto" }}
          >
            {RINGS.map((r, i) => {
              const o = (400 - r.size) / 2;
              const lit = r.tag === active || r.tag === hovered;
              return (
                <g
                  key={r.tag}
                  onMouseEnter={() => setHovered(r.tag)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => setActive(r.tag)}
                  style={{ cursor: "pointer" }}
                >
                  {/* fat invisible hit area so thin strokes are easy to target */}
                  <rect
                    x={o - 12}
                    y={o - 12}
                    width={r.size + 24}
                    height={r.size + 24}
                    fill="transparent"
                  />
                  <rect
                    x={o}
                    y={o}
                    width={r.size}
                    height={r.size}
                    fill="none"
                    stroke={lit ? r.hot : r.base}
                    strokeWidth={r.tag === active ? 1.5 : 1}
                    pathLength={1}
                    strokeDasharray="1"
                    strokeDashoffset={visible ? 0 : 1}
                    style={{
                      transition: `stroke-dashoffset 1.1s ease ${i * 180}ms, stroke 0.2s ease`,
                      opacity: !visible ? 0 : lit ? 1 : 0.55,
                    }}
                  />
                  <text
                    x={o + 12}
                    y={o + 26}
                    fill={lit ? "#f4f4f4" : "#5a5a5a"}
                    fontSize="12"
                    letterSpacing="0.18em"
                    fontFamily="ui-monospace, Menlo, monospace"
                    style={{ transition: "fill 0.2s ease", pointerEvents: "none" }}
                  >
                    {r.tag}
                  </text>
                </g>
              );
            })}
          </svg>

          {/* readout — the legend, attached to the graphic */}
          <div
            key={active}
            className="ring-readout"
            style={{ marginTop: 8, borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: 20 }}
          >
            <div style={{ display: "flex", gap: 8 }}>
              {RINGS.map((r) => (
                <button
                  key={r.tag}
                  onClick={() => setActive(r.tag)}
                  className="mono"
                  style={{
                    cursor: "pointer",
                    fontSize: 10,
                    letterSpacing: "0.16em",
                    padding: "6px 12px",
                    border: "1px solid #3a3a3a",
                    background: r.tag === active ? "#e8e8e8" : "transparent",
                    color: r.tag === active ? "#000" : "#8a8a8a",
                  }}
                >
                  {r.tag}
                </button>
              ))}
            </div>
            <div
              className="mono"
              style={{
                marginTop: 14,
                fontSize: 34,
                color: "#f4f4f4",
                letterSpacing: "0.01em",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              ${counted.toFixed(1)}B
            </div>
            <p style={{ marginTop: 8, fontSize: 14.5, lineHeight: 1.6, color: "#8a8a8a" }}>
              {ring.desc}
            </p>
            <a
              href={ring.href}
              target={ring.href.startsWith("http") ? "_blank" : undefined}
              rel={ring.href.startsWith("http") ? "noreferrer" : undefined}
              className="link mono"
              style={{ fontSize: 11, letterSpacing: "0.08em" }}
            >
              SOURCE: {ring.src.toUpperCase()} ↗
            </a>
          </div>
        </div>

        <div>
          <p
            className="mono"
            style={{ fontSize: 11, letterSpacing: "0.2em", color: "#5a5a5a" }}
          >
            LEDGER OF LOSSES — SOURCED
          </p>
          <div style={{ marginTop: 18, display: "grid" }}>
            {LOSSES.map((l, i) => (
              <a
                key={l.amount + l.src}
                href={l.href}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 20,
                  padding: "18px 0",
                  borderTop: "1px solid rgba(255,255,255,0.08)",
                  textDecoration: "none",
                  opacity: visible ? 1 : 0,
                  transform: visible ? "none" : "translateY(14px)",
                  transition: `opacity 0.5s ease ${300 + i * 110}ms, transform 0.5s ease ${300 + i * 110}ms`,
                }}
              >
                <span>
                  <span
                    className="mono"
                    style={{ fontSize: 19, color: "#f4f4f4", letterSpacing: "0.02em" }}
                  >
                    {l.amount}
                  </span>
                  <span
                    style={{
                      display: "block",
                      marginTop: 6,
                      fontSize: 14,
                      lineHeight: 1.55,
                      color: "#8a8a8a",
                    }}
                  >
                    {l.what}
                  </span>
                </span>
                <span
                  className="mono link"
                  style={{
                    fontSize: 10,
                    letterSpacing: "0.14em",
                    whiteSpace: "nowrap",
                    paddingTop: 4,
                  }}
                >
                  {l.src.toUpperCase()} ↗
                </span>
              </a>
            ))}
          </div>
          <p
            className="mono"
            style={{
              marginTop: 18,
              fontSize: 10,
              letterSpacing: "0.1em",
              lineHeight: 1.8,
              color: "#3f3f3f",
            }}
          >
            TAM/SAM: ANALYST ESTIMATES, LINKED. SOM: CUBIC ESTIMATE. LOSSES:
            PUBLICLY REPORTED INCIDENTS, LINKED.
          </p>
        </div>
      </div>
    </section>
  );
}
