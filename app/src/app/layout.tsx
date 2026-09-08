import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Authorization Network",
  description: "Cloudflare for agent actions — authorize agent tool calls with identity, policy, and trust",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
