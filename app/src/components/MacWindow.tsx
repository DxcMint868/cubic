"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

export type WindowTab = { id: string; label: string };

const BAR = 44;
const Y_SEP = BAR - 0.5;
const Y_TOP = 10;
const CORNER = 9;

function Circle({ filled }: { filled?: boolean }) {
  return (
    <span
      style={{
        width: 12,
        height: 12,
        borderRadius: "50%",
        border: `1px solid ${filled ? "#f4f4f4" : "#c9c9c9"}`,
        background: filled ? "#f4f4f4" : "transparent",
        flexShrink: 0,
      }}
    />
  );
}

export default function MacWindow({
  tabs,
  activeTab,
  onTabChange,
  title,
  children,
  style,
}: {
  tabs?: WindowTab[];
  activeTab?: string;
  onTabChange?: (id: string) => void;
  title?: string;
  children: ReactNode;
  style?: React.CSSProperties;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [geom, setGeom] = useState({ w: 0, bx: 0, bw: 0 });
  const [tabW, setTabW] = useState(0);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const measure = () => {
      const btn = wrap.querySelector<HTMLElement>("[data-active-tab]");
      // offset* are layout metrics — unaffected by ancestor transforms
      // all tabs share the widest tab's width
      const all = wrap.querySelectorAll<HTMLElement>("[data-tab]");
      const maxW = Math.max(0, ...Array.from(all, (b) => b.offsetWidth));
      setTabW(maxW);
      setGeom({
        w: wrap.offsetWidth,
        bx: btn ? btn.offsetLeft : 0,
        bw: btn ? btn.offsetWidth : 0,
      });
    };
    measure();
    if (document.fonts) document.fonts.ready.then(measure).catch(() => {});
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [activeTab, tabs, tabW]);

  const hasTab = geom.bw > 0;
  const L = geom.bx + 9;
  const R = geom.bx + geom.bw - 9;

  // Tab outline: sides run down to the separator with concave bottom corners
  // that flare outward and merge into the separator, which is broken under
  // the active tab so tab and content read as one surface.
  const mainPath = hasTab
    ? `M ${L - CORNER} ${Y_SEP}
       Q ${L} ${Y_SEP} ${L} ${Y_SEP - CORNER}
       V ${Y_TOP + CORNER}
       Q ${L} ${Y_TOP} ${L + CORNER} ${Y_TOP}
       H ${R - CORNER}
       Q ${R} ${Y_TOP} ${R} ${Y_TOP + CORNER}
       V ${Y_SEP - CORNER}
       Q ${R} ${Y_SEP} ${R + CORNER} ${Y_SEP}`
    : "";

  // Horizontal separator segments as fills: a 1.5px-tall rect always fully
  // covers at least one device row, unlike a 1px stroke on a fractional
  // half-pixel boundary which antialiases to ~50% brightness.
  const SEP_H = 1.5;
  const SEP_Y = Y_SEP - SEP_H / 2;

  return (
    <div
      ref={wrapRef}
      style={{
        position: "relative",
        background: "#0b0b0b",
        border: "1px solid #c9c9c9",
        borderRadius: 10,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        ...style,
      }}
    >
      {geom.w > 0 && (
        <svg
          width={geom.w}
          height={BAR}
          viewBox={`0 0 ${geom.w} ${BAR}`}
          preserveAspectRatio="none"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            zIndex: 1,
            pointerEvents: "none",
          }}
        >
          {hasTab ? (
            <>
              <rect x={0} y={SEP_Y} width={Math.max(L - CORNER + 1, 0)} height={SEP_H} fill="#c9c9c9" />
              <rect x={R + CORNER - 1} y={SEP_Y} width={Math.max(geom.w - R - CORNER + 1, 0)} height={SEP_H} fill="#c9c9c9" />
              <path
                d={mainPath}
                fill="none"
                stroke="#c9c9c9"
                strokeWidth="1"
                strokeLinecap="round"
              />
            </>
          ) : (
            <rect x={0} y={SEP_Y} width={geom.w} height={SEP_H} fill="#c9c9c9" />
          )}
        </svg>
      )}

      <div
        style={{
          height: BAR,
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          padding: "0 16px",
        }}
      >
        <div style={{ display: "flex", gap: 4 }}>
          {tabs
            ? tabs.map((t) => {
                const active = t.id === activeTab;
                return (
                  <button
                    key={t.id}
                    onClick={() => onTabChange?.(t.id)}
                    data-tab=""
                    data-active-tab={active ? "" : undefined}
                    className={active ? "mono" : "mono tab-inactive"}
                    style={{
                      position: "relative",
                      height: 34,
                      minWidth: tabW || undefined,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      padding: "0 18px",
                      cursor: "pointer",
                      fontSize: 11,
                      letterSpacing: "0.06em",
                      background: active ? "#0b0b0b" : "transparent",
                      color: active ? "#e8e8e8" : "#5a5a5a",
                      border: "none",
                    }}
                  >
                    <span style={{ position: "relative" }}>{t.label}</span>
                    <span
                      style={{
                        position: "relative",
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: active ? "#f4f4f4" : "#3a3a3a",
                      }}
                    />
                  </button>
                );
              })
            : title && (
                <span
                  className="mono"
                  style={{
                    fontSize: 11,
                    letterSpacing: "0.14em",
                    color: "#6a6a6a",
                    paddingBottom: 14,
                  }}
                >
                  {title}
                </span>
              )}
        </div>

        <div
          style={{
            display: "flex",
            gap: 8,
            alignSelf: "center",
            paddingBottom: 2,
          }}
        >
          <Circle />
          <Circle />
          <Circle filled />
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, background: "#000" }}>{children}</div>
    </div>
  );
}
