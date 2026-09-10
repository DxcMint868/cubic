import Link from "next/link";
import DetailsSection from "@/components/DetailsSection";
import HeroCopy from "@/components/HeroCopy";
import Logo from "@/components/Logo";
import Manifesto from "@/components/Manifesto";
import NetworkCanvas from "@/components/NetworkCanvas";
import PartnerMarquee from "@/components/PartnerMarquee";
import TeamSection from "@/components/TeamSection";

const headerNav = [
  { label: "PRODUCT", href: "/" },
  { label: "NETWORK", href: "/network" },
  { label: "DOCS", href: "#" },
];
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
      <header className="site-header">
        <a href="#" style={{ textDecoration: "none" }}>
          <Logo fontSize={24} />
        </a>

        <nav className="mono">
          {headerNav.map((item) =>
            item.href.startsWith("/") ? (
              <Link key={item.label} href={item.href} className="link">
                {item.label}
              </Link>
            ) : (
              <a key={item.label} href={item.href} className="link">
                {item.label}
              </a>
            )
          )}
        </nav>

        <a href="#" className="btn-outline">
          GET ACCESS
        </a>
      </header>

      <div className="hero">
        <section className="hero-copy">
          <HeroCopy />
        </section>

        <div className="hero-canvas-wrap">
          <NetworkCanvas />
        </div>
      </div>

      <section
        className="section-pad"
        style={{
          minHeight: "72vh",
          display: "flex",
          alignItems: "center",
          borderTop: "1px solid rgba(255,255,255,0.07)",
        }}
      >
        <Manifesto />
      </section>

      <TeamSection />

      <PartnerMarquee />

      <DetailsSection />

      <footer className="mono site-footer">
        <span>© 2026 CUBIC</span>

        <nav>
          {footerLinks.map((item) => (
            <a key={item} href="#" className="link">
              {item}
            </a>
          ))}
        </nav>

        <span className="footer-tag">AGENT AUTHORIZATION GATEWAY</span>
      </footer>
    </main>
  );
}
