import type { Metadata } from "next";
import { Darker_Grotesque } from "next/font/google";
import { WalletProvider } from "@/components/WalletProvider";
import "./globals.css";

const darkerGrotesque = Darker_Grotesque({
  subsets: ["latin"],
  weight: ["400", "500", "700", "800"],
});

export const metadata: Metadata = {
  title: "Cubic — Cloudflare for agent actions",
  description:
    "Every agent tool call checked against identity, intent, policy, and trust.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={darkerGrotesque.className}>
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
