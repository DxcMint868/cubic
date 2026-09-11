"use client";

import Link from "next/link";
import Logo from "@/components/Logo";
import { useWallet } from "@/components/WalletProvider";

const NAV = [
  { label: "CONSOLE", href: "/console" },
  { label: "NETWORK", href: "/network" },
  { label: "DOCS", href: "#" },
];

export default function SiteHeader({ active }: { active?: string }) {
  const { address, connect, disconnect } = useWallet();

  return (
    <header className="site-header">
      <Link href="/" style={{ textDecoration: "none" }}>
        <Logo fontSize={24} />
      </Link>

      <nav className="mono">
        {NAV.map((item) =>
          item.href.startsWith("/") ? (
            <Link
              key={item.label}
              href={item.href}
              className="link"
              style={
                active === item.label
                  ? { color: "#fff", textDecoration: "none" }
                  : undefined
              }
            >
              {item.label}
            </Link>
          ) : (
            <a key={item.label} href={item.href} className="link">
              {item.label}
            </a>
          )
        )}
      </nav>

      {address ? (
        <button
          onClick={disconnect}
          className="btn-outline mono"
          style={{
            background: "transparent",
            cursor: "pointer",
            fontSize: 11,
            letterSpacing: "0.14em",
          }}
          title="Disconnect (mock)"
        >
          {address}
        </button>
      ) : (
        <button
          onClick={connect}
          className="btn-outline mono"
          style={{
            background: "transparent",
            cursor: "pointer",
            fontSize: 11,
            letterSpacing: "0.14em",
          }}
        >
          CONNECT WALLET
        </button>
      )}
    </header>
  );
}
