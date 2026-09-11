import MacWindow from "@/components/MacWindow";

export function PageHead({
  eyebrow,
  title,
  sub,
}: {
  eyebrow: string;
  title: string;
  sub?: string;
}) {
  return (
    <div>
      <p
        className="mono"
        style={{ fontSize: 11, letterSpacing: "0.2em", color: "#5a5a5a" }}
      >
        {eyebrow}
      </p>
      <h1
        style={{
          marginTop: 14,
          fontSize: "clamp(28px, 3.4vw, 48px)",
          fontWeight: 700,
          letterSpacing: "-0.02em",
          lineHeight: 1.1,
          color: "#f4f4f4",
        }}
      >
        {title}
      </h1>
      {sub && (
        <p
          style={{
            marginTop: 12,
            fontSize: 14.5,
            lineHeight: 1.65,
            color: "#8a8a8a",
            maxWidth: 640,
          }}
        >
          {sub}
        </p>
      )}
    </div>
  );
}

export function StatRow({
  stats,
}: {
  stats: { value: string; label: string }[];
}) {
  return (
    <div
      style={{
        marginTop: 26,
        paddingTop: 22,
        borderTop: "1px solid rgba(255,255,255,0.1)",
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
        gap: "20px 28px",
      }}
    >
      {stats.map((s) => (
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
  );
}

export function Panel({
  title,
  children,
  style,
}: {
  title: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <MacWindow title={title} style={style}>
      <div style={{ padding: "24px 24px 26px" }}>{children}</div>
    </MacWindow>
  );
}

export const th: React.CSSProperties = {
  textAlign: "left",
  fontSize: 9.5,
  letterSpacing: "0.16em",
  color: "#5a5a5a",
  fontWeight: 400,
  padding: "0 12px 12px 0",
  whiteSpace: "nowrap",
};

export const td: React.CSSProperties = {
  fontSize: 13,
  color: "#c9c9c9",
  padding: "12px 12px 12px 0",
  borderTop: "1px solid rgba(255,255,255,0.07)",
  verticalAlign: "top",
};

export function DecisionTag({ d }: { d: string }) {
  const filled = d === "ALLOW";
  return (
    <span
      className="mono"
      style={{
        display: "inline-block",
        fontSize: 10,
        letterSpacing: "0.12em",
        padding: "4px 10px",
        border: "1px solid #3a3a3a",
        background: filled ? "#e8e8e8" : "transparent",
        color: filled ? "#000" : "#c9c9c9",
        whiteSpace: "nowrap",
      }}
    >
      {d}
    </span>
  );
}

export function Skeleton({
  height = 14,
  width = "100%",
  style,
}: {
  height?: number;
  width?: number | string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      aria-hidden
      style={{
        height,
        width,
        background: "#161616",
        animation: "blink 1.6s steps(2, start) infinite",
        ...style,
      }}
    />
  );
}

export function ErrorWindow({
  code,
  message,
  title = "ERROR",
}: {
  code: string;
  message: string;
  title?: string;
}) {
  return (
    <MacWindow title={title}>
      <div style={{ padding: "26px 24px 28px" }}>
        <div
          className="mono"
          style={{ fontSize: 11, letterSpacing: "0.16em", color: "#e8e8e8" }}
        >
          {code}
        </div>
        <p style={{ marginTop: 10, fontSize: 14, lineHeight: 1.6, color: "#8a8a8a" }}>
          {message}
        </p>
      </div>
    </MacWindow>
  );
}

export function EmptyState({ children }: { children?: React.ReactNode }) {
  return (
    <div
      className="mono"
      style={{
        border: "1px solid #232323",
        borderRadius: 10,
        padding: "34px 24px",
        textAlign: "center",
        fontSize: 11,
        letterSpacing: "0.14em",
        lineHeight: 1.8,
        color: "#5a5a5a",
      }}
    >
      {children ?? "No live events yet — run the demo agent or the swarm."}
    </div>
  );
}

export function ProviderBadge({ provider }: { provider: string }) {
  const ledger = provider === "ledger";
  return (
    <span
      className="mono"
      style={{
        display: "inline-block",
        fontSize: 9.5,
        letterSpacing: "0.14em",
        padding: "3px 8px",
        border: ledger ? "1px solid #e8e8e8" : "1px solid #3a3a3a",
        background: ledger ? "#e8e8e8" : "transparent",
        color: ledger ? "#000" : "#8a8a8a",
        whiteSpace: "nowrap",
      }}
      title={ledger ? "Ledger provider" : "Development provider"}
    >
      {ledger ? "LEDGER" : "DEV"}
    </span>
  );
}

export function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="mono"
      style={{
        display: "inline-block",
        fontSize: 9.5,
        letterSpacing: "0.12em",
        padding: "3px 8px",
        border: "1px solid #3a3a3a",
        color: "#c9c9c9",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}
