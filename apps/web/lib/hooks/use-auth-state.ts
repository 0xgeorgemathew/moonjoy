"use client";

import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { useCallback, useEffect, useRef, useState } from "react";
import type { OnboardResponse, SetupStatus } from "@/lib/types/auth";

export function useAuthState() {
  const { ready, authenticated, getAccessToken } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { client: smartWalletClient } = useSmartWallets();

  const [onboardResult, setOnboardResult] =
    useState<OnboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onboardingInFlight = useRef(false);

  const embeddedWallet = wallets.find(
    (w) => w.walletClientType === "privy",
  );
  const embeddedAddress = embeddedWallet?.address ?? null;
  const smartAccountAddress =
    (smartWalletClient as { account?: { address?: string } } | undefined)
      ?.account?.address ?? null;

  const setupStatus: SetupStatus = (() => {
    if (!ready || !walletsReady) return "loading";
    if (!authenticated) return "unauthenticated";
    if (onboardResult) return "complete";
    if (error) return "complete";
    return "onboarding";
  })();

  const fetchOnboard = useCallback(async (): Promise<OnboardResponse> => {
    const accessToken = await getAccessToken();
    if (!accessToken) {
      throw new Error("No access token available");
    }

    const res = await fetch("/api/auth/onboard", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        embeddedSignerAddress: embeddedAddress,
        smartAccountAddress,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Onboarding failed: ${res.status}`);
    }

    return (await res.json()) as OnboardResponse;
  }, [getAccessToken, embeddedAddress, smartAccountAddress]);

  useEffect(() => {
    if (!ready || !walletsReady) return;
    if (!authenticated) return;
    if (!embeddedAddress || !smartAccountAddress) return;
    if (onboardingInFlight.current) return;
    if (onboardResult) return;
    onboardingInFlight.current = true;

    fetchOnboard()
      .then(setOnboardResult)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Onboarding failed");
        onboardingInFlight.current = false;
      });
  }, [ready, walletsReady, authenticated, embeddedAddress, smartAccountAddress, onboardResult, fetchOnboard]);

  return { setupStatus, onboardResult, error, embeddedAddress, smartAccountAddress };
}
