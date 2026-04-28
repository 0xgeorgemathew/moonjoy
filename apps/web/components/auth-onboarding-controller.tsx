"use client";

import { useAuthState } from "@/lib/hooks/use-auth-state";
import { usePrivy } from "@privy-io/react-auth";

export function AuthOnboardingController() {
  const { authenticated } = usePrivy();
  useAuthState();

  if (!authenticated) return null;
  return null;
}
