import Link from "next/link";

const COLS: { head: string; links: { label: string; href: string }[] }[] = [
  {
    head: "PRODUCT",
    links: [
      { label: "CONSOLE", href: "/console" },
      { label: "NETWORK", href: "/network" },
      { label: "FAQ", href: "/faq" },
    ],
  },
  {
    head: "PROTOCOL",
    links: [
      { label: "ERC-8004", href: "https://eips.ethereum.org/EIPS/eip-8004" },
      { label: "THE GRAPH", href: "https://thegraph.com/docs/en/subgraphs/existing-subgraphs/agent0/" },
      { label: "X402 / HEDERA", href: "#" },
    ],
  },
  {
    head: "COMPANY",
    links: [
      { label: "GITHUB", href: "#" },
      { label: "DOCS", href: "#" },
      { label: "CONTACT", href: "#" },
    ],
  },
];

export default function SiteFooter() {
  return (
    <footer
      style={{
        borderTop: "1px solid rgba(255,255,255,0.07)",
        padding: "56px 7vw 28px",
      }}
    >
      <div className="footer-grid">
        <div>
          <p style={{ fontWeight: 800, fontSize: 22, letterSpacing: "-0.03em", color: "#f4f4f4" }}>
            Cubic
            <span
              aria-hidden
              style={{
                display: "inline-block",
                width: "0.13em",
                height: "0.13em",
                marginLeft: "0.08em",
                border: "0.028em solid currentColor",
                borderRadius: "18%",
              }}
            />
          </p>
          <p
            className="mono"
            style={{ marginTop: 12, fontSize: 11, letterSpacing: "0.12em", color: "#5a5a5a", lineHeight: 1.9 }}
          >
            AGENT AUTHORIZATION GATEWAY
          </p>
        </div>

        {COLS.map((c) => (
          <div key={c.head}>
            <p className="mono" style={{ fontSize: 10, letterSpacing: "0.2em", color: "#3f3f3f" }}>
              {c.head}
            </p>
            <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
              {c.links.map((l) =>
                l.href.startsWith("/") ? (
                  <Link key={l.label} href={l.href} className="link mono" style={{ fontSize: 12, letterSpacing: "0.1em" }}>
                    {l.label}
                  </Link>
                ) : (
                  <a key={l.label} href={l.href} className="link mono" style={{ fontSize: 12, letterSpacing: "0.1em" }}>
                    {l.label}
                  </a>
                )
              )}
            </div>
          </div>
        ))}
      </div>

      <div
        className="mono"
        style={{
          marginTop: 48,
          paddingTop: 20,
          borderTop: "1px solid rgba(255,255,255,0.07)",
          display: "flex",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "10px 20px",
          fontSize: 10,
          letterSpacing: "0.14em",
          color: "#3f3f3f",
        }}
      >
        <span>© 2026 CUBIC</span>
        <span>CUBIC.ETH — COMING SOON</span>
      </div>
    </footer>
  );
}
