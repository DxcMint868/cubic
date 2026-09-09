"use client";

import { useState } from "react";

export default function DitherImage({
  src,
  alt,
  label,
  style,
}: {
  src: string;
  alt: string;
  label: string;
  style?: React.CSSProperties;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <div
      style={{
        position: "relative",
        aspectRatio: "1",
        overflow: "hidden",
        background: "#0a0a0a",
        border: "1px solid #1e1e1e",
        ...style,
      }}
    >
      {failed ? (
        <div
          className="mono"
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 11,
            letterSpacing: "0.16em",
            color: "#4a4a4a",
          }}
        >
          {label}
        </div>
      ) : (
        <img
          src={src}
          alt={alt}
          onError={() => setFailed(true)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
            filter: "grayscale(1) contrast(1.4) brightness(1.05)",
          }}
        />
      )}

      {/* halftone dither overlay */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          backgroundImage:
            "radial-gradient(circle, rgba(0,0,0,0.85) 1px, transparent 1.4px)",
          backgroundSize: "3px 3px",
          mixBlendMode: "multiply",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          backgroundImage:
            "radial-gradient(circle, rgba(255,255,255,0.28) 0.6px, transparent 0.9px)",
          backgroundSize: "3px 3px",
          mixBlendMode: "screen",
        }}
      />
    </div>
  );
}
