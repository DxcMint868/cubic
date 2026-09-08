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
            fontSize: "clamp(72px, 9vw, 128px)",
            fontWeight: 800,
            letterSpacing: "-0.03em",
            lineHeight: 0.95,
            color: "#f4f4f4",
          }}
        >
          Cubic
          <span
            aria-hidden
            style={{
              display: "inline-block",
              width: "0.13em",
              height: "0.13em",
              marginLeft: "0.08em",
              border: "0.028em solid #f4f4f4",
              borderRadius: "18%",
            }}
          />
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
          style={{
            marginTop: 30,
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
          maskImage: "linear-gradient(to right, transparent 0%, black 22%)",
          WebkitMaskImage: "linear-gradient(to right, transparent 0%, black 22%)",
        }}
      >
        <NetworkCanvas />
      </div>
    </main>
  );
}
