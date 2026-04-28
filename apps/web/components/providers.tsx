"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { SmartWalletsProvider } from "@privy-io/react-auth/smart-wallets";
import { NetworkProvider, useNetwork } from "@/lib/hooks/use-network";
import { base, baseSepolia } from "viem/chains";
import type { ReactNode } from "react";

function PrivyStack({ children }: { children: ReactNode }) {
  const { chain } = useNetwork();

  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
      config={{
        embeddedWallets: {
          createOnLogin: "users-without-wallets",
        },
        supportedChains: [base, baseSepolia],
        defaultChain: chain,
        appearance: {
          theme: "dark",
        },
      }}
    >
      <SmartWalletsProvider>{children}</SmartWalletsProvider>
    </PrivyProvider>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <NetworkProvider>
      <PrivyStack>{children}</PrivyStack>
    </NetworkProvider>
  );
}
