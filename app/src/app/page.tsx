import DetailsSection from "@/components/DetailsSection";
import HeroCopy from "@/components/HeroCopy";
import Manifesto from "@/components/Manifesto";
import MarketSection from "@/components/MarketSection";
import NetworkCanvas from "@/components/NetworkCanvas";
import PartnerMarquee from "@/components/PartnerMarquee";
import SiteHeader from "@/components/SiteHeader";
import TeamSection from "@/components/TeamSection";

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
      <SiteHeader />

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

      <MarketSection />

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
