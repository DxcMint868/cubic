import NetworkCanvas from "@/components/NetworkCanvas";

const mono = 'ui-monospace, "SF Mono", Menlo, monospace';

export default function Home() {
  return (
    <main
      style={{
        position: "fixed",
        inset: 0,
        background: "#000",
        display: "flex",
        alignItems: "stretch",
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
        <h1
          style={{
            fontSize: "clamp(36px, 4.2vw, 60px)",
            fontWeight: 550,
            letterSpacing: "-0.025em",
            lineHeight: 1.05,
            color: "#f4f4f4",
          }}
        >
          Agent Authorization
          <br />
          Network
        </h1>

        <p
          style={{
            marginTop: 22,
            fontSize: 16,
            lineHeight: 1.6,
            color: "#8a8a8a",
            maxWidth: 420,
          }}
        >
          Cloudflare for agent actions — every tool call evaluated against
          identity, intent, policy, and trust.
        </p>

        <p
          style={{
            marginTop: 28,
            fontFamily: mono,
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
          maskImage:
            "linear-gradient(to right, transparent 0%, black 22%)",
          WebkitMaskImage:
            "linear-gradient(to right, transparent 0%, black 22%)",
        }}
      >
        <NetworkCanvas />
      </div>
    </main>
  );
}
