"use client";

import { useEffect, useRef } from "react";

const TEXT =
  "AI agents are gaining access to everything — codebases, infrastructure, money — with credentials they can leak and authority they were never meant to hold. Cubic sits between agents and their tools. Every tool call becomes an intent, evaluated against identity, policy, and live trust context — then allowed, denied, or escalated. Agents receive scoped, expiring capabilities, never raw keys. We authorize. Existing tools execute. Every decision is recorded.";

const DIM = [0x3a, 0x3a, 0x3a];
const BRIGHT = [0xf4, 0xf4, 0xf4];
const RAMP = 8; // words inside the fade zone at any moment

export default function Manifesto() {
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const words = Array.from(el.querySelectorAll<HTMLElement>("[data-w]"));
    const n = words.length;
    let raf = 0;

    const update = () => {
      raf = 0;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight;
      // 0 when the paragraph enters at the bottom of the viewport,
      // 1 once its bottom has risen past the reading band
      const p = Math.min(
        1,
        Math.max(0, (vh * 0.85 - rect.top) / (vh * 0.45 + rect.height))
      );
      for (let i = 0; i < n; i++) {
        const t = Math.min(1, Math.max(0, (p * (n + RAMP) - i) / RAMP));
        const c = DIM.map((d, k) => Math.round(d + (BRIGHT[k] - d) * t));
        words[i].style.color = `rgb(${c[0]},${c[1]},${c[2]})`;
      }
    };

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <p
      ref={ref}
      style={{
        maxWidth: "min(1080px, 100%)",
        fontSize: "clamp(26px, 3.2vw, 46px)",
        fontWeight: 700,
        letterSpacing: "-0.02em",
        lineHeight: 1.28,
        color: "rgb(58,58,58)",
      }}
    >
      {TEXT.split(" ").map((w, i) => (
        <span key={i} data-w="" style={{ color: "rgb(58,58,58)" }}>
          {w}{" "}
        </span>
      ))}
    </p>
  );
}
