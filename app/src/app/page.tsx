import Logo from "@/components/Logo";
import NetworkCanvas from "@/components/NetworkCanvas";
import TeamSection from "@/components/TeamSection";

const mono = 'ui-monospace, "SF Mono", Menlo, monospace';

const headerNav = ["PRODUCT", "NETWORK", "DOCS"];
const footerLinks = ["GITHUB", "DOCS", "CONTACT"];

export default function Home() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        background: "#000",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <header
        style={{
          position: "sticky",
          top: 14,
          zIndex: 10,
          width: "min(1040px, 86vw)",
          margin: "14px auto 0",
          background: "#0d0d0d",
          border: "1px solid #232323",
          borderRadius: 12,
          height: 54,
          padding: "0 22px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
        <a href="#" style={{ textDecoration: "none" }}>
          <Logo fontSize={24} />
        </a>

        <nav
          className="mono"
          style={{
            display: "flex",
            gap: 36,
            fontSize: 11,
            letterSpacing: "0.18em",
          }}
        >
          {headerNav.map((item) => (
            <a key={item} href="#" className="link">
              {item}
            </a>
          ))}
        </nav>

        <a href="#" className="btn-outline">
          GET ACCESS
        </a>
      </header>

      <div
        style={{
          height: "calc(100dvh - 82px)",
          minHeight: 540,
          display: "flex",
          alignItems: "stretch",
          position: "relative",
        }}
      >
        <section
          style={{
            width: "44%",
            minWidth: 420,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            paddingLeft: "7vw",
            paddingRight: 48,
            position: "relative",
            zIndex: 1,
          }}
        >
          <h1 style={{ margin: 0 }}>
            <Logo fontSize="clamp(72px, 9vw, 128px)" />
          </h1>

          <p
            style={{
              marginTop: 26,
              fontSize: 20,
              fontWeight: 500,
              letterSpacing: "-0.01em",
              color: "#e0e0e0",
            }}
          >
            Cloudflare for agent actions.
          </p>

          <p
            style={{
              marginTop: 12,
              fontSize: 15,
              lineHeight: 1.6,
              color: "#8a8a8a",
              maxWidth: 440,
            }}
          >
            Every agent tool call checked against identity, intent, policy, and
            trust.
          </p>

          <p
            className="mono"
            style={{
              marginTop: 30,
              fontSize: 12,
              letterSpacing: "0.12em",
              color: "#5a5a5a",
            }}
          >
            intent → policy → capability → execution
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
        </section>

        <div
          style={{
            flex: 1,
            position: "relative",
            maskImage: "linear-gradient(to right, transparent 0%, black 22%)",
            WebkitMaskImage:
              "linear-gradient(to right, transparent 0%, black 22%)",
          }}
        >
          <NetworkCanvas />
        </div>
      </div>

      <section
        style={{
          minHeight: "72vh",
          display: "flex",
          alignItems: "center",
          padding: "14vh 7vw",
          borderTop: "1px solid rgba(255,255,255,0.07)",
        }}
      >
        <p
          style={{
            maxWidth: 1080,
            fontSize: "clamp(26px, 3.2vw, 46px)",
            fontWeight: 700,
            letterSpacing: "-0.02em",
            lineHeight: 1.28,
            color: "#f4f4f4",
          }}
        >
          AI agents are gaining access to everything — codebases,
          infrastructure, money — with credentials they can leak and authority
          they were never meant to hold. Cubic sits between agents and their
          tools. Every tool call becomes an intent, evaluated against
          identity, policy, and live trust context — then allowed, denied, or
          escalated. Agents receive scoped, expiring capabilities, never raw
          keys.{" "}
          <span style={{ color: "#5a5a5a" }}>
            We authorize. Existing tools execute. Every decision is recorded.
          </span>
        </p>
      </section>

      <TeamSection />

      <footer
        className="mono"
        style={{
          height: 52,
          padding: "0 7vw",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderTop: "1px solid rgba(255,255,255,0.07)",
          fontSize: 11,
          letterSpacing: "0.14em",
          color: "#555",
          flexShrink: 0,
        }}
      >
        <span>© 2026 CUBIC</span>

        <nav style={{ display: "flex", gap: 28 }}>
          {footerLinks.map((item) => (
            <a key={item} href="#" className="link">
              {item}
            </a>
          ))}
        </nav>

        <span>AGENT AUTHORIZATION GATEWAY</span>
      </footer>
    </main>
  );
}
