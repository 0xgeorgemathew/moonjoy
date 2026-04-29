"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import type { OnboardResponse, SetupStatus } from "@/lib/types/auth";

type AuthStateValue = {
  setupStatus: SetupStatus;
  onboardResult: OnboardResponse | null;
  error: string | null;
  embeddedAddress: string | null;
  smartAccountAddress: string | null;
};

type KeyedValue<T> = {
  key: string;
  value: T;
};

const AuthStateContext = createContext<AuthStateValue | null>(null);

function useAuthStateValue(): AuthStateValue {
  const { ready, authenticated, getAccessToken } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { client: smartWalletClient } = useSmartWallets();
  const [onboardResult, setOnboardResult] =
    useState<KeyedValue<OnboardResponse> | null>(null);
  const [error, setError] = useState<KeyedValue<string> | null>(null);
  const onboardingKeyRef = useRef<string | null>(null);

  const embeddedWallet = wallets.find((wallet) => wallet.walletClientType === "privy");
  const embeddedAddress = embeddedWallet?.address ?? null;
  const smartAccountAddress =
    (smartWalletClient as { account?: { address?: string } } | undefined)?.account
      ?.address ?? null;
  const walletKey =
    authenticated && embeddedAddress && smartAccountAddress
      ? `${embeddedAddress.toLowerCase()}:${smartAccountAddress.toLowerCase()}`
      : null;
  const currentOnboardResult =
    walletKey && onboardResult?.key === walletKey ? onboardResult.value : null;
  const currentError = walletKey && error?.key === walletKey ? error.value : null;

  const setupStatus: SetupStatus = (() => {
    if (!ready || !walletsReady) return "loading";
    if (!authenticated) return "unauthenticated";
    if (currentError) return "error";
    if (currentOnboardResult) return "complete";
    return "onboarding";
  })();

  const fetchOnboard = useCallback(async (): Promise<OnboardResponse> => {
    const accessToken = await getAccessToken();

    if (!accessToken) {
      throw new Error("No access token available");
    }

    const response = await fetch("/api/auth/onboard", {
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

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `Onboarding failed: ${response.status}`);
    }

    return (await response.json()) as OnboardResponse;
  }, [embeddedAddress, getAccessToken, smartAccountAddress]);

  useEffect(() => {
    if (!walletKey || !ready || !walletsReady || !authenticated) {
      return;
    }

    if (onboardingKeyRef.current === walletKey || currentOnboardResult) {
      return;
    }

    onboardingKeyRef.current = walletKey;

    fetchOnboard()
      .then((result) => {
        setOnboardResult({ key: walletKey, value: result });
        setError(null);
      })
      .catch((err: unknown) => {
        setError({
          key: walletKey,
          value: err instanceof Error ? err.message : "Onboarding failed",
        });
        onboardingKeyRef.current = null;
      });
  }, [
    authenticated,
    currentOnboardResult,
    fetchOnboard,
    ready,
    walletKey,
    walletsReady,
  ]);

  return {
    setupStatus,
    onboardResult: currentOnboardResult,
    error: currentError,
    embeddedAddress,
    smartAccountAddress,
  };
}

export function AuthStateProvider({ children }: { children: ReactNode }) {
  return (
    <AuthStateContext.Provider value={useAuthStateValue()}>
      {children}
    </AuthStateContext.Provider>
  );
}

export function useAuthState(): AuthStateValue {
  const context = useContext(AuthStateContext);

  if (!context) {
    throw new Error("useAuthState must be used within an AuthStateProvider");
  }

  return context;
}
