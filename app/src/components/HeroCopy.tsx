"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Logo from "@/components/Logo";
import { useWallet } from "@/components/WalletProvider";

const PIPELINE = "intent → policy → capability → execution";
const TYPE_MS = 34;
const TYPE_START_DELAY = 600;

const MODELS = [
  "Fable 5",
  "GPT Astra",
  "Grok 4.6",
  "Gemini 3 Ultra",
  "Llama 5",
  "DeepSeek V4",
  "Mistral 4",
  "Qwen 3 Max",
];
const HOLD_MS = 1100;
const DELETE_MS = 40;
const TYPE_MODEL_MS = 65;

// Mock counters — PROJECT.md §10 demo-network figures until real telemetry
// exists. The "SIMULATED ACTIVITY" tag below must stay while these are mock.
const STATS = [
  { value: "1,842", label: "AGENTS ONLINE" },
  { value: "24,921", label: "INTENTS EVALUATED" },
  { value: "23,884", label: "ALLOWED" },
  { value: "123", label: "ESCALATED" },
];

export default function HeroCopy() {
  const [typed, setTyped] = useState(0);
  const [modelText, setModelText] = useState(MODELS[0]);
  const [nextModel, setNextModel] = useState(1);
  const [phase, setPhase] = useState<"hold" | "delete" | "type">("hold");
  const { address, connect } = useWallet();

  useEffect(() => {
    if (typed >= PIPELINE.length) return;
    const id = setTimeout(
      () => setTyped((t) => t + 1),
      typed === 0 ? TYPE_START_DELAY : TYPE_MS
    );
    return () => clearTimeout(id);
  }, [typed]);

  useEffect(() => {
    if (phase === "hold") {
      const id = setTimeout(() => setPhase("delete"), HOLD_MS);
      return () => clearTimeout(id);
    }
    if (phase === "delete") {
      if (modelText === "") {
        setPhase("type");
        return;
      }
      const id = setTimeout(() => setModelText((t) => t.slice(0, -1)), DELETE_MS);
      return () => clearTimeout(id);
    }
    const target = MODELS[nextModel];
    if (modelText.length < target.length) {
      const id = setTimeout(
        () => setModelText(target.slice(0, modelText.length + 1)),
        TYPE_MODEL_MS
      );
      return () => clearTimeout(id);
    }
    setNextModel((nextModel + 1) % MODELS.length);
    setPhase("hold");
  }, [phase, modelText, nextModel]);

  return (
    <>
      <h1 style={{ margin: 0 }}>
        <Logo fontSize="clamp(88px, 11vw, 160px)" />
      </h1>

      <p
        style={{
          marginTop: 30,
          fontSize: "clamp(22px, 1.9vw, 30px)",
          fontWeight: 500,
          letterSpacing: "-0.01em",
          color: "#e0e0e0",
        }}
      >
        Cloudflare for agent actions.
      </p>

      <p
        style={{
          marginTop: 18,
          fontSize: "clamp(15px, 1.3vw, 20px)",
          fontWeight: 500,
          letterSpacing: "-0.005em",
          color: "#9a9a9a",
        }}
      >
        Your{" "}
        <span className="mono" style={{ color: "#fff" }}>
          {modelText}
        </span>{" "}
        can&apos;t escape the cube
        <span
          aria-hidden
          style={{
            display: "inline-block",
            width: "0.5em",
            height: "0.5em",
            marginLeft: "0.28em",
            border: "0.055em solid #9a9a9a",
            borderRadius: "18%",
            verticalAlign: "-0.04em",
          }}
        />
      </p>

      <p
        className="mono"
        style={{
          marginTop: 34,
          fontSize: 12,
          letterSpacing: "0.12em",
          color: "#5a5a5a",
        }}
      >
        {PIPELINE.slice(0, typed)}
        <span
          style={{
            display: "inline-block",
            width: 8,
            height: 12,
            marginLeft: 8,
            background: "#5a5a5a",
            verticalAlign: "middle",
            animation: "blink 1.2s steps(1) infinite",
          }}
        />
      </p>

      <div
        style={{
          marginTop: 34,
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        {address ? (
          <Link
            href="/console"
            className="mono"
            style={{
              display: "inline-block",
              padding: "12px 26px",
              background: "#f4f4f4",
              border: "1px solid #f4f4f4",
              color: "#000",
              fontSize: 11,
              letterSpacing: "0.14em",
              textDecoration: "none",
            }}
          >
            ENTER CONSOLE →
          </Link>
        ) : (
          <button
            onClick={connect}
            className="mono"
            style={{
              cursor: "pointer",
              padding: "12px 26px",
              background: "#f4f4f4",
              border: "1px solid #f4f4f4",
              color: "#000",
              fontSize: 11,
              letterSpacing: "0.14em",
            }}
          >
            CONNECT WALLET
          </button>
        )}
        <Link href="/network" className="btn-outline mono" style={{ padding: "12px 26px" }}>
          VIEW NETWORK
        </Link>
      </div>

      <div
        style={{
          marginTop: 38,
          paddingTop: 26,
          borderTop: "1px solid rgba(255,255,255,0.1)",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))",
          gap: "22px 28px",
          maxWidth: 560,
        }}
      >
        {STATS.map((s) => (
          <div key={s.label}>
            <div
              className="mono"
              style={{ fontSize: 19, color: "#e8e8e8", letterSpacing: "0.02em" }}
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

      <div
        className="mono"
        style={{
          marginTop: 16,
          fontSize: 9.5,
          letterSpacing: "0.16em",
          color: "#3f3f3f",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
      </div>
    </>
  );
}
