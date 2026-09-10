"use client";

import { useEffect, useRef, useState } from "react";
import MacWindow from "@/components/MacWindow";

const CARDS = [
  {
    title: "01 / THE GATE",
    heading: "What does Cubic do?",
    body: "Every agent tool call is intercepted and normalized into an intent — who is calling, what action, on which resource. A deterministic policy engine evaluates it against identity, context, and tenant rules, then answers one of three things: allow, deny, or escalate. On allow, the agent gets a scoped, expiring capability — never a reusable API key.",
    bullets: [
      "Normalizes any tool call into a structured intent",
      "Deterministic ALLOW / DENY / ESCALATE — never an LLM guess",
      "Scoped, expiring capabilities instead of raw credentials",
      "Existing MCP servers and executors keep doing the execution",
    ],
  },
  {
    title: "02 / TRUST CONTEXT",
    heading: "How are risky calls judged?",
    body: "Decisions draw on live context: the agent's ERC-8004 identity and reputation, validation records indexed by The Graph's Agent0 subgraphs, recent activity, and resource sensitivity. Low-risk calls flow autonomously. High-risk ones — production deploys, fund movements — pause for hardware-backed approval through Ledger before proceeding.",
    bullets: [
      "ERC-8004 identity, reputation & validation via The Graph",
      "High-risk actions require Ledger hardware approval",
      "Prompt-injection attempts hit the policy wall and get DENY",
      "Every intent → decision → capability → result is recorded",
    ],
  },
  {
    title: "03 / MACHINE PAYMENTS",
    heading: "How do agents pay for tools?",
    body: "When an agent needs a paid service — a security scan, an inference call — the invoice is treated as one more action to authorize. The gateway checks the tenant's spend policy: is the service allowlisted, is the amount within budget, does the agent's reputation clear the bar? Approved payments settle over x402 on Hedera, and the receipt joins the same auditable chain.",
    bullets: [
      "402 invoices normalized into payment intents",
      "Per-task budgets, service allowlists, reputation thresholds",
      "Settlement over x402 on Hedera via the Blocky402 facilitator",
      "Receipts recorded alongside every other agent action",
    ],
  },
];

export default function DetailsSection() {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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

  return (
    <section
      className="section-pad"
      style={{
        borderTop: "1px solid rgba(255,255,255,0.07)",
      }}
    >
      <p
        className="mono"
        style={{
          fontSize: 11,
          letterSpacing: "0.2em",
          color: "#5a5a5a",
        }}
      >
        THE PRODUCT
      </p>

      <h2
        style={{
          marginTop: 18,
          fontSize: "clamp(34px, 4.5vw, 64px)",
          fontWeight: 700,
          letterSpacing: "-0.02em",
          lineHeight: 1.1,
          color: "#f4f4f4",
        }}
      >
        Every call, interrogated.
      </h2>

      <div
        ref={ref}
        className="details-grid"
        style={{
          marginTop: "7vh",
        }}
      >
        {CARDS.map((card, i) => (
          <div
            key={card.title}
            style={{
              display: "flex",
              transform: visible ? "none" : "scale(0.55)",
              opacity: visible ? 1 : 0,
              transformOrigin: "center",
              transition:
                "transform 0.6s cubic-bezier(0.3, 1.35, 0.55, 1), opacity 0.35s ease",
              transitionDelay: `${i * 140}ms`,
            }}
          >
            <MacWindow title={card.title} style={{ flex: 1 }}>
            <div style={{ padding: "34px 30px 38px" }}>
              <h3
                style={{
                  fontSize: 23,
                  fontWeight: 700,
                  letterSpacing: "-0.01em",
                  lineHeight: 1.3,
                  color: "#e8e8e8",
                }}
              >
                {card.heading}
              </h3>

              <p
                style={{
                  marginTop: 18,
                  fontSize: 15.5,
                  lineHeight: 1.65,
                  color: "#8a8a8a",
                }}
              >
                {card.body}
              </p>

              <div style={{ marginTop: 26, display: "grid", gap: 13 }}>
                {card.bullets.map((b) => (
                  <div
                    key={b}
                    style={{
                      display: "flex",
                      gap: 12,
                      fontSize: 14.5,
                      lineHeight: 1.5,
                      color: "#9a9a9a",
                    }}
                  >
                    <span className="mono" style={{ color: "#5a5a5a" }}>
                      &gt;
                    </span>
                    <span>{b}</span>
                  </div>
                ))}
              </div>
            </div>
          </MacWindow>
          </div>
        ))}
      </div>
    </section>
  );
}
