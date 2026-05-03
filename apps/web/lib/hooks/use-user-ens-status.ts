"use client";

import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";

export interface UserEnsStatus {
  userEnsName: string | null;
  embeddedSignerAddress: string | null;
  agentEnsName: string | null;
  expectedAgentEnsName: string | null;
  agentRegistrationState: "blocked" | "action_required" | "pending" | "ready";
  pendingAgentTransaction: {
    txHash: string | null;
    userOperationHash: string | null;
    submittedAt: string;
  } | null;
  agentStats: {
    matchesPlayed: number;
    streak: number;
    source: "ens" | "database";
    syncing: boolean;
  } | null;
  activeStrategies: {
    public: {
      id: string;
      name: string;
      strategy_kind: "public";
      status: string;
      manifest_pointer: string;
      updated_at: string;
    } | null;
    secretSauce: {
      id: string;
      name: string;
      strategy_kind: "secret_sauce";
      status: string;
      manifest_pointer: string;
      updated_at: string;
    } | null;
  };
  textRecords: { record_key: string; record_value: string }[];
}

type UserEnsStatusResult = {
  accessToken: string | null;
  ensStatus: UserEnsStatus | null;
  loading: boolean;
};

const IDLE_RESULT: UserEnsStatusResult = {
  accessToken: null,
  ensStatus: null,
  loading: false,
};

export function useUserEnsStatus(enabled: boolean): UserEnsStatusResult {
  const { getAccessToken } = usePrivy();
  const [result, setResult] = useState<UserEnsStatusResult>(IDLE_RESULT);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;

    const fetchStatus = async () => {
      setResult((current) => ({
        accessToken: current.accessToken,
        ensStatus: current.ensStatus,
        loading: true,
      }));

      try {
        const accessToken = await getAccessToken();
        if (!accessToken || cancelled) {
          return;
        }

        const response = await fetch("/api/ens/status", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!response.ok || cancelled) {
          return;
        }

        const ensStatus = (await response.json()) as UserEnsStatus;

        if (!cancelled) {
          setResult({
            accessToken,
            ensStatus,
            loading: false,
          });
        }
      } catch {
        if (!cancelled) {
          setResult({
            accessToken: null,
            ensStatus: null,
            loading: false,
          });
        }
      }
    };

    void fetchStatus();

    const interval = window.setInterval(() => {
      if (
        result.ensStatus?.agentRegistrationState === "pending" ||
        result.ensStatus?.agentRegistrationState === "action_required"
      ) {
        void fetchStatus();
      }
    }, 8000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [enabled, getAccessToken, result.ensStatus?.agentRegistrationState]);

  return enabled ? result : IDLE_RESULT;
}
