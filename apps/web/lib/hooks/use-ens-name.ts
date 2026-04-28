"use client";

import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";

interface EnsNameResult {
  ensName: string | null;
  loading: boolean;
  error: Error | null;
}

const IDLE_RESULT: EnsNameResult = {
  ensName: null,
  loading: false,
  error: null,
};

export function useEnsName(enabled: boolean): EnsNameResult {
  const { getAccessToken } = usePrivy();
  const [result, setResult] = useState<EnsNameResult>(IDLE_RESULT);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    (async () => {
      setResult({ ensName: null, loading: true, error: null });
      try {
        const token = await getAccessToken();
        if (!token || cancelled) return;

        const res = await fetch("/api/ens/status", {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!res.ok || cancelled) {
          if (!cancelled) setResult({ ensName: null, loading: false, error: new Error("Failed to fetch ENS status") });
          return;
        }

        const data = await res.json();
        if (!cancelled) {
          setResult({ ensName: data.userEnsName, loading: false, error: null });
        }
      } catch (err) {
        if (!cancelled) {
          setResult({
            ensName: null,
            loading: false,
            error: err instanceof Error ? err : new Error("Unknown error"),
          });
        }
      }
    })();

    return () => { cancelled = true; };
  }, [enabled, getAccessToken]);

  return enabled ? result : IDLE_RESULT;
}
