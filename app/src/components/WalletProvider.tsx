"use client";

import { createContext, useContext, useState } from "react";

const MOCK_ADDRESS = "0x3f…9a1c";

const WalletCtx = createContext<{
  address: string | null;
  connect: () => void;
  disconnect: () => void;
}>({ address: null, connect: () => {}, disconnect: () => {} });

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  return (
    <WalletCtx.Provider
      value={{
        address,
        connect: () => setAddress(MOCK_ADDRESS),
        disconnect: () => setAddress(null),
      }}
    >
      {children}
    </WalletCtx.Provider>
  );
}

export function useWallet() {
  return useContext(WalletCtx);
}
