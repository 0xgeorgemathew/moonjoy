"use client";

import { createContext, useCallback, useContext, useSyncExternalStore } from "react";
import { base, baseSepolia } from "viem/chains";
import type { Chain } from "viem";
import type { ReactNode } from "react";

export type NetworkMode = "mainnet" | "testnet";

interface NetworkContextValue {
  networkMode: NetworkMode;
  chain: Chain;
  chainId: number;
  isTestnet: boolean;
  toggle: () => void;
  setNetworkMode: (mode: NetworkMode) => void;
}

const NetworkContext = createContext<NetworkContextValue | null>(null);

const CHAIN_MAP: Record<NetworkMode, Chain> = {
  mainnet: base,
  testnet: baseSepolia,
};

const STORAGE_KEY = "moonjoy-network-mode";

function subscribe(cb: () => void) {
  const handler = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) cb();
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}

function getSnapshot(): NetworkMode {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "testnet" || stored === "mainnet") return stored;
  return "mainnet";
}

function getServerSnapshot(): NetworkMode {
  return "mainnet";
}

export function NetworkProvider({ children }: { children: ReactNode }) {
  const networkMode = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setNetworkMode = useCallback((mode: NetworkMode) => {
    localStorage.setItem(STORAGE_KEY, mode);
    window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
  }, []);

  const toggle = useCallback(() => {
    setNetworkMode(getSnapshot() === "mainnet" ? "testnet" : "mainnet");
  }, [setNetworkMode]);

  const chain = CHAIN_MAP[networkMode];

  return (
    <NetworkContext.Provider
      value={{
        networkMode,
        chain,
        chainId: chain.id,
        isTestnet: networkMode === "testnet",
        toggle,
        setNetworkMode,
      }}
    >
      {children}
    </NetworkContext.Provider>
  );
}

export function useNetwork(): NetworkContextValue {
  const context = useContext(NetworkContext);
  if (!context) throw new Error("useNetwork must be used within a NetworkProvider");
  return context;
}
