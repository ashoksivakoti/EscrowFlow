"use client";

import "@/lib/polyfill-indexeddb-node";

import "@rainbow-me/rainbowkit/styles.css";

import {
  getDefaultConfig,
  lightTheme,
  RainbowKitProvider,
} from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import type { Chain } from "wagmi/chains";
import { baseSepolia, hardhat, mainnet, sepolia } from "wagmi/chains";

const CHAIN_MAP: Record<number, Chain> = {
  1: mainnet,
  11155111: sepolia,
  84532: baseSepolia,
  31337: hardhat,
  1337: hardhat,
};

function resolveChains(): [Chain, ...Chain[]] {
  const raw = process.env.NEXT_PUBLIC_CHAIN_IDS ?? "84532,31337";
  const ids = raw
    .split(",")
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => !Number.isNaN(n));
  const out = ids.map((id) => CHAIN_MAP[id]).filter(Boolean) as Chain[];
  if (out.length === 0) {
    return [hardhat];
  }
  return [out[0]!, ...out.slice(1)];
}

const wagmiConfig = getDefaultConfig({
  appName: "EscrowFlow",
  projectId: resolveWalletConnectProjectId(),
  chains: resolveChains(),
  ssr: true,
});

const rkTheme = lightTheme({
  accentColor: "#4f46e5",
  accentColorForeground: "white",
  borderRadius: "large",
});

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
          },
        },
      }),
  );

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={rkTheme}>{children}</RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

function resolveWalletConnectProjectId(): string {
  const value = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();
  if (value) {
    return value;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID must be set in production");
  }
  return "development-only";
}
