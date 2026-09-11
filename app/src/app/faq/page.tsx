import FaqList from "@/components/FaqList";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";

export default function FaqPage() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        background: "#000",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <SiteHeader active="FAQ" />

      <div className="section-pad" style={{ flex: 1 }}>
        <p
          className="mono"
          style={{ fontSize: 11, letterSpacing: "0.2em", color: "#5a5a5a" }}
        >
          FAQ
        </p>
        <h1
          style={{
            marginTop: 18,
            fontSize: "clamp(34px, 4.5vw, 64px)",
            fontWeight: 700,
            letterSpacing: "-0.02em",
            lineHeight: 1.1,
            color: "#f4f4f4",
          }}
        >
          Asked, answered.
        </h1>
        <p
          style={{
            marginTop: 16,
            fontSize: 15.5,
            lineHeight: 1.65,
            color: "#8a8a8a",
            maxWidth: 640,
          }}
        >
          The short version of the product, the security model, and where
          every partner fits.
        </p>

        <FaqList />
      </div>

      <SiteFooter />
    </main>
  );
}
