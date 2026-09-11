"use client";

// Closing CTA — converts the whole narrative into one action. Wired to
// the real (mock-for-now) wallet state: connect here or jump to console.
import Link from "next/link";
import CloserCanvas from "@/components/CloserCanvas";
import { useWallet } from "@/components/WalletProvider";

export default function Closer() {
  const { address, connect } = useWallet();

  return (
    <section
      className="section-pad"
      style={{
        position: "relative",
        overflow: "hidden",
        borderTop: "1px solid rgba(255,255,255,0.07)",
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          WebkitMaskImage:
            "radial-gradient(ellipse 72% 68% at 50% 46%, black 25%, transparent 78%)",
          maskImage:
            "radial-gradient(ellipse 72% 68% at 50% 46%, black 25%, transparent 78%)",
        }}
      >
        <CloserCanvas />
      </div>

      <div
        style={{
          position: "relative",
          zIndex: 1,
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
      <span
        aria-hidden
        style={{
          display: "inline-block",
          width: 30,
          height: 30,
          border: "1px solid #5a5a5a",
          position: "relative",
        }}
      >
        <span
          style={{ position: "absolute", inset: 12, background: "#8a8a8a" }}
        />
      </span>

      <h2
        style={{
          marginTop: 28,
          fontSize: "clamp(38px, 5.5vw, 76px)",
          fontWeight: 700,
          letterSpacing: "-0.02em",
          lineHeight: 1.05,
          color: "#f4f4f4",
          maxWidth: 760,
        }}
      >
        Put your agents inside the cube.
      </h2>

      <p
        style={{
          marginTop: 18,
          fontSize: 16,
          lineHeight: 1.65,
          color: "#8a8a8a",
          maxWidth: 560,
        }}
      >
        Connect a wallet to open your tenant console — register agents,
        write policies, and watch every tool call get interrogated.
      </p>

      <div
        style={{
          marginTop: 34,
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          justifyContent: "center",
        }}
      >
        {address ? (
          <Link
            href="/console"
            className="mono"
            style={{
              display: "inline-block",
              padding: "13px 28px",
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
              padding: "13px 28px",
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
        <a href="#" className="btn-outline mono" style={{ padding: "13px 28px" }}>
          READ DOCS
        </a>
      </div>

      {address && (
        <p
          className="mono"
          style={{
            marginTop: 22,
            fontSize: 10,
            letterSpacing: "0.14em",
            color: "#3f3f3f",
          }}
        >
          CONNECTED — {address}
        </p>
      )}
      </div>
    </section>
  );
}
