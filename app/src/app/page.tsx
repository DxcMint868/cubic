import HeroCopy from "@/components/HeroCopy";
import Logo from "@/components/Logo";
import Manifesto from "@/components/Manifesto";
import NetworkCanvas from "@/components/NetworkCanvas";
import TeamSection from "@/components/TeamSection";

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
            width: "46%",
            minWidth: 440,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            paddingLeft: "7vw",
            paddingRight: 48,
            position: "relative",
            zIndex: 1,
          }}
        >
          <HeroCopy />
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
        <Manifesto />
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
