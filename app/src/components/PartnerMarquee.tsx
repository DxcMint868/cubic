// Placeholder partner strip — logos replace the text names later.
const PARTNERS = [
  "THE GRAPH",
  "HEDERA",
  "LEDGER",
  "ERC-8004",
  "AGENT0",
  "BLOCKY402",
  "MCP",
];

function PartnerRow({ ariaHidden }: { ariaHidden?: boolean }) {
  return (
    <div
      aria-hidden={ariaHidden}
      style={{
        display: "flex",
        alignItems: "center",
        flexShrink: 0,
      }}
    >
      {PARTNERS.map((name) => (
        <span
          key={name}
          className="mono"
          style={{
            display: "flex",
            alignItems: "center",
            fontSize: "clamp(10px, 1.2vw, 12px)",
            letterSpacing: "0.24em",
            color: "#5a5a5a",
            whiteSpace: "nowrap",
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              margin: "0 clamp(18px, 3vw, 42px)",
              border: "1px solid #3a3a3a",
              flexShrink: 0,
            }}
          />
          {name}
        </span>
      ))}
    </div>
  );
}

export default function PartnerMarquee() {
  return (
    <div
      style={{
        overflow: "hidden",
        borderTop: "1px solid rgba(255,255,255,0.07)",
        borderBottom: "1px solid rgba(255,255,255,0.07)",
        padding: "26px 0",
      }}
    >
      <div className="marquee-track">
        <PartnerRow />
        <PartnerRow ariaHidden />
      </div>
    </div>
  );
}
