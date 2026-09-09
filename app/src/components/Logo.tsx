export default function Logo({
  fontSize = 18,
  color = "#f4f4f4",
}: {
  fontSize?: number | string;
  color?: string;
}) {
  return (
    <span
      style={{
        fontWeight: 800,
        fontSize,
        letterSpacing: "-0.03em",
        lineHeight: 1,
        color,
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
          border: "0.028em solid currentColor",
          borderRadius: "18%",
        }}
      />
    </span>
  );
}
