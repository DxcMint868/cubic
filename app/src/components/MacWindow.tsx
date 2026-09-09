"use client";

import type { ReactNode } from "react";

export type WindowTab = { id: string; label: string };

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
  return (
    <div
      style={{
        background: "#0b0b0b",
        border: "1px solid #c9c9c9",
        borderRadius: 10,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        ...style,
      }}
    >
      <div
        style={{
          height: 44,
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          padding: "0 16px",
          borderBottom: "1px solid #1e1e1e",
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
                    className="mono"
                    style={{
                      fontSize: 11,
                      letterSpacing: "0.06em",
                      padding: "6px 14px",
                      cursor: "pointer",
                      background: active ? "#000" : "transparent",
                      color: active ? "#e8e8e8" : "#5a5a5a",
                      border: "1px solid",
                      borderColor: active ? "#c9c9c9" : "transparent",
                      borderRadius: "9px 9px 8px 8px",
                      marginBottom: -1,
                      position: "relative",
                      zIndex: 1,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    {t.label}
                    <span
                      style={{
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
