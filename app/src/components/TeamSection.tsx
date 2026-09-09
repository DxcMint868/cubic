"use client";

import { useEffect, useRef, useState } from "react";
import MacWindow from "@/components/MacWindow";
import DitherImage from "@/components/DitherImage";

const tabs = [
  { id: "tron", label: "tron.jpeg", brightness: 1.05 },
  { id: "min", label: "min.jpeg", brightness: 0.85 },
];

const ROTATE_MS = 7000;

export default function TeamSection() {
  const [activeTab, setActiveTab] = useState(tabs[0].id);
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
      { rootMargin: "0px 0px -30% 0px", threshold: 0 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => {
      setActiveTab((cur) => {
        const i = tabs.findIndex((t) => t.id === cur);
        return tabs[(i + 1) % tabs.length].id;
      });
    }, ROTATE_MS);
    return () => clearInterval(id);
  }, [visible, activeTab]);

  return (
    <section
      id="team"
      ref={ref}
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(340px, 5fr) 6fr",
        gap: 72,
        padding: "14vh 7vw",
        borderTop: "1px solid rgba(255,255,255,0.07)",
        alignItems: "center",
      }}
    >
      <div
        style={{
          transform: visible ? "none" : "translateX(-90px) scale(0.78)",
          opacity: visible ? 1 : 0,
          transformOrigin: "left center",
          transition:
            "transform 0.9s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.5s ease",
        }}
      >
        <MacWindow tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab}>
          <div style={{ position: "relative", aspectRatio: "1" }}>
            {tabs.map((t) => (
              <div
                key={t.id}
                style={{
                  position: "absolute",
                  inset: 0,
                  opacity: activeTab === t.id ? 1 : 0,
                  transition: "opacity 0.6s ease",
                }}
              >
                <DitherImage
                  src={`/dev_imgs/${t.id}.jpeg`}
                  alt={t.label}
                  label={`${t.id.toUpperCase()} — 1:1`}
                  brightness={t.brightness}
                  style={{ width: "100%", height: "100%", border: "none" }}
                />
              </div>
            ))}
          </div>
        </MacWindow>
      </div>

      <p
        style={{
          fontSize: "clamp(22px, 2.3vw, 34px)",
          fontWeight: 500,
          letterSpacing: "-0.015em",
          lineHeight: 1.42,
          color: "#e8e8e8",
        }}
      >
        From the former Web3 engineers behind centralized-exchange
        infrastructure — systems where one leaked key is a lost company — and
        the author of an ERC-8004 research publication on onchain agent
        identity.{" "}
        <span style={{ color: "#5a5a5a" }}>
          We spent years guarding the keys. Now we&apos;re building the layer
          that means agents never hold them.
        </span>
      </p>
    </section>
  );
}
