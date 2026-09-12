"use client";

// FAQ accordion — answers drafted from PROJECT.md (§2 boundaries, §3
// architecture, §5 intent handling, §7/8/15 partners, §13 competitors).
// Copy is UI-owned; expect product edits before launch.
import { useState } from "react";

const QA: { q: string; a: string[] }[] = [
  {
    q: "What is Cubic?",
    a: [
      "Cubic is an agent authorization gateway — Cloudflare for agent actions. It sits between your AI agents and their tools, evaluates every meaningful tool call against identity, intent, policy, and trust, then allows, denies, or escalates it. Agents receive scoped, short-lived capabilities instead of broad reusable credentials.",
    ],
  },
  {
    q: "How does one authorization work?",
    a: [
      "Agent → Intent → Policy/Context Evaluation → Allow | Deny | Escalate → Capability → Tool Execution → Result → Audit Event. The agent's tool call is normalized into a structured intent, a deterministic policy engine decides, and on allow the agent gets a capability naming exactly one action on exactly one resource with an expiry — never a raw API key.",
    ],
  },
  {
    q: "Why not just give the agent an API key?",
    a: [
      "Once a credential reaches the agent process, prompt injection, malicious tool output, or a compromised MCP server can turn a narrowly intended action into general access. Cubic changes the unit of authorization from credential possession to action capability: the agent can ask, policy decides, and the capability expires in minutes.",
    ],
  },
  {
    q: "Does an LLM decide what is allowed?",
    a: [
      "No. AI may classify or summarize intent — turning “review PR 421 and deploy it if safe” into structured fields — but the deterministic policy engine is the final ALLOW / DENY / ESCALATE authority. An LLM never gets the last word on a dangerous action.",
    ],
  },
  {
    q: "What happens to high-risk actions?",
    a: [
      "They escalate. Production deploys, fund movements, and anything over a spend cap pause in the approvals queue until a human approves — wired for Ledger Key Ring approval on provisioned hosts; this demo runs the in-app dev stand-in. Low-risk reads keep flowing autonomously.",
    ],
  },
  {
    q: "How do agents pay for things?",
    a: [
      "A paid service answers 402 Payment Required; the gateway treats the invoice as one more intent to authorize — allowlisted service, per-task budget, reputation bar. Approved payments settle over x402 on Hedera through the Blocky402 facilitator, and the receipt joins the same audit chain as every other action.",
    ],
  },
  {
    q: "Where does The Graph fit in?",
    a: [
      "Agent0 and ERC-8004 subgraphs supply live identity, reputation, and validation context that policies evaluate against — not dashboard decoration. The agent can also query that data natively through the Subgraph MCP, and streaming activity feeds the network view.",
    ],
  },
  {
    q: "How is this different from OPA, Vault, or MCP?",
    a: [
      "OPA evaluates policies; Vault protects secrets; MCP standardizes agent ↔ tool calls; Composio executes integrations. Cubic composes them around the missing runtime layer: what is this specific agent trying to do right now, and is it authorized to do exactly that? We govern the action boundary — existing systems keep executing.",
    ],
  },
  {
    q: "What data goes onchain?",
    a: [
      "Only what belongs there: identity, reputation, validation, attestations, payments, and anchors. Detailed tenant audit data — prompts, arguments, secrets, runbooks — stays offchain and private. The public network view only ever shows anonymized aggregates.",
    ],
  },
  {
    q: "How do I get access?",
    a: [
      "Connect a wallet in the header to open your tenant console: register agents, write policies, clear approvals, and inspect the full audit chain. Everything is mock data today — live gateway telemetry plugs in as it lands.",
    ],
  },
];

export default function FaqList() {
  const [open, setOpen] = useState(0);
  return (
    <div style={{ marginTop: "5vh", display: "grid" }}>
      {QA.map((item, i) => {
        const on = i === open;
        return (
          <div
            key={item.q}
            style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}
          >
            <button
              onClick={() => setOpen(on ? -1 : i)}
              aria-expanded={on}
              className="mono"
              style={{
                width: "100%",
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                gap: 20,
                padding: "22px 0",
                background: "transparent",
                border: "none",
                textAlign: "left",
                color: on ? "#f4f4f4" : "#c9c9c9",
                fontFamily: "inherit",
              }}
            >
              <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.01em", fontFamily: "var(--font-sans, inherit)" }}>
                {item.q}
              </span>
              <span
                aria-hidden
                style={{
                  fontSize: 13,
                  color: "#5a5a5a",
                  border: "1px solid #2e2e2e",
                  width: 26,
                  height: 26,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  background: on ? "#e8e8e8" : "transparent",
                }}
              >
                <span style={{ color: on ? "#000" : "#8a8a8a" }}>
                  {on ? "–" : "+"}
                </span>
              </span>
            </button>
            {on && (
              <div className="ring-readout" style={{ padding: "0 0 26px", maxWidth: 720 }}>
                {item.a.map((p) => (
                  <p
                    key={p.slice(0, 24)}
                    style={{ fontSize: 15, lineHeight: 1.7, color: "#8a8a8a" }}
                  >
                    {p}
                  </p>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }} />
    </div>
  );
}
