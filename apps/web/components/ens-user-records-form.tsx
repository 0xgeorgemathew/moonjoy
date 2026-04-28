"use client";

import { useCallback, useMemo, useState } from "react";
import { useWallets, useSendTransaction, usePrivy } from "@privy-io/react-auth";
import { type Address } from "viem";
import { encodeFunctionData } from "viem";
import { baseSepolia } from "viem/chains";
import { durinRegistryAbi, DURIN_L2_REGISTRY_ADDRESS } from "@moonjoy/contracts";
import { getNameNode } from "@/lib/services/ens-service";

type PreferenceStatus = "idle" | "signing" | "confirming" | "confirmed" | "failed";
type MatchDuration = 3 | 5 | 10;
type WagerUsd = 10 | 25 | 50;
type TradingCapitalUsd = 100 | 250 | 500;

interface MatchPreference {
  durationMinutes: MatchDuration;
  wagerUsd: WagerUsd;
  tradingCapitalUsd: TradingCapitalUsd;
}

interface EnsUserRecordsFormProps {
  ensName: string;
  label: string;
  embeddedAddress: string;
  existingRecords: { record_key: string; record_value: string }[];
}

const RECORD_KEY = "moonjoy:match_preference";

const DEFAULT_PREFERENCE: MatchPreference = {
  durationMinutes: 5,
  wagerUsd: 10,
  tradingCapitalUsd: 100,
};

const DURATION_OPTIONS: readonly MatchDuration[] = [3, 5, 10];
const WAGER_OPTIONS: readonly WagerUsd[] = [10, 25, 50];
const CAPITAL_OPTIONS: readonly TradingCapitalUsd[] = [100, 250, 500];

function stringifyPreference(preference: MatchPreference): string {
  return JSON.stringify({
    schema: "moonjoy.match_preference.v1",
    matchmaking: "auto",
    durationMinutes: preference.durationMinutes,
    wagerUsd: preference.wagerUsd,
    tradingCapitalUsd: preference.tradingCapitalUsd,
  });
}

function parseDuration(value: unknown): MatchDuration {
  if (value === "3m") return 3;
  if (value === "5m") return 5;
  if (value === "10m") return 10;
  if (DURATION_OPTIONS.includes(value as MatchDuration)) return value as MatchDuration;
  return DEFAULT_PREFERENCE.durationMinutes;
}

function parseWager(value: unknown): WagerUsd {
  if (WAGER_OPTIONS.includes(value as WagerUsd)) return value as WagerUsd;
  return DEFAULT_PREFERENCE.wagerUsd;
}

function parseCapital(value: unknown): TradingCapitalUsd {
  if (CAPITAL_OPTIONS.includes(value as TradingCapitalUsd)) return value as TradingCapitalUsd;
  return DEFAULT_PREFERENCE.tradingCapitalUsd;
}

function preferenceFromRecord(recordValue: string | undefined): MatchPreference {
  if (!recordValue) return DEFAULT_PREFERENCE;

  try {
    const parsed = JSON.parse(recordValue) as {
      duration?: unknown;
      durationMinutes?: unknown;
      wagerUsd?: unknown;
      tradingCapitalUsd?: unknown;
    };
    return {
      durationMinutes: parseDuration(parsed.durationMinutes ?? parsed.duration),
      wagerUsd: parseWager(parsed.wagerUsd),
      tradingCapitalUsd: parseCapital(parsed.tradingCapitalUsd),
    };
  } catch {
    return DEFAULT_PREFERENCE;
  }
}

export function EnsUserRecordsForm({
  ensName,
  label,
  embeddedAddress,
  existingRecords,
}: EnsUserRecordsFormProps) {
  const { wallets } = useWallets();
  const { sendTransaction } = useSendTransaction();
  const { getAccessToken } = usePrivy();
  const existingRecord = existingRecords.find((record) => record.record_key === RECORD_KEY);
  const [preference, setPreference] = useState(() => preferenceFromRecord(existingRecord?.record_value));
  const [savedPreference, setSavedPreference] = useState(() => preferenceFromRecord(existingRecord?.record_value));
  const [status, setStatus] = useState<PreferenceStatus>(existingRecord ? "confirmed" : "idle");
  const [error, setError] = useState<string | null>(null);

  const recordValue = useMemo(() => stringifyPreference(preference), [preference]);
  const savedRecordValue = useMemo(() => stringifyPreference(savedPreference), [savedPreference]);
  const isBusy = status === "signing" || status === "confirming";
  const isSaved = status === "confirmed" && recordValue === savedRecordValue;

  function updatePreference(update: Partial<MatchPreference>) {
    const next = { ...preference, ...update };
    setPreference(next);
    setStatus(stringifyPreference(next) === savedRecordValue ? "confirmed" : "idle");
    setError(null);
  }

  const handleSave = useCallback(async () => {
    setStatus("signing");
    setError(null);

    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        setStatus("failed");
        setError("Not authenticated");
        return;
      }

      const embeddedWallet = wallets.find(
        (wallet: { walletClientType: string }) => wallet.walletClientType === "privy",
      );
      if (!embeddedWallet) {
        setStatus("failed");
        setError("Embedded wallet not found");
        return;
      }

      const node = await getNameNode(label);
      const callData = encodeFunctionData({
        abi: durinRegistryAbi,
        functionName: "setText",
        args: [node, RECORD_KEY, recordValue],
      });

      const txResult = await sendTransaction(
        {
          to: DURIN_L2_REGISTRY_ADDRESS as Address,
          data: callData,
          chainId: baseSepolia.id,
        },
        {
          sponsor: true,
          address: embeddedAddress,
          uiOptions: { showWalletUIs: false },
        },
      );

      const txHash = txResult.hash;

      setStatus("confirming");

      const res = await fetch("/api/ens/set-user-text-record", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          ensName,
          key: RECORD_KEY,
          value: recordValue,
          transactionHash: txHash,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setStatus("failed");
        setError(data.error || "Could not verify record");
        return;
      }

      setSavedPreference(preference);
      setStatus("confirmed");
    } catch (err) {
      setStatus("failed");
      setError(err instanceof Error ? err.message : "Could not save preference");
    }
  }, [getAccessToken, wallets, sendTransaction, embeddedAddress, label, recordValue, ensName, preference]);

  return (
    <div className="space-y-5">
      <div>
        <p className="font-display text-sm font-bold uppercase tracking-wider text-black">
          Matchmaking Preferences
        </p>
        <p className="mt-1 font-body text-xs text-gray-500">
          Public defaults for automatch. Challenge links can still use custom settings.
        </p>
      </div>

      <div className="space-y-5">
        <PreferenceButtonGroup
          label="Duration"
          value={preference.durationMinutes}
          options={DURATION_OPTIONS}
          format={(value) => `${value}m`}
          disabled={isBusy}
          onChange={(durationMinutes) => updatePreference({ durationMinutes })}
        />
        <PreferenceButtonGroup
          label="Bet"
          value={preference.wagerUsd}
          options={WAGER_OPTIONS}
          format={(value) => `$${value}`}
          disabled={isBusy}
          onChange={(wagerUsd) => updatePreference({ wagerUsd })}
        />
        <PreferenceButtonGroup
          label="Capital"
          value={preference.tradingCapitalUsd}
          options={CAPITAL_OPTIONS}
          format={(value) => `$${value}`}
          disabled={isBusy}
          onChange={(tradingCapitalUsd) => updatePreference({ tradingCapitalUsd })}
        />
      </div>

      <button
        type="button"
        onClick={handleSave}
        disabled={isBusy || isSaved}
        className="neo-btn-secondary w-full px-4 py-3 font-display text-xs font-bold uppercase tracking-wider disabled:cursor-not-allowed disabled:opacity-40"
      >
        {status === "signing" ? "Sign Record" : status === "confirming" ? "Verifying" : isSaved ? "Saved" : "Save Preference"}
      </button>

      {error && (
        <p className="font-label text-[10px] uppercase tracking-wider text-artemis-red">
          {error}
        </p>
      )}
    </div>
  );
}

function PreferenceButtonGroup<T extends number>({
  label,
  value,
  options,
  format,
  disabled,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  format: (value: T) => string;
  disabled: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex items-center gap-4">
      <span className="w-20 shrink-0 font-label text-[10px] uppercase tracking-wider text-gray-500">
        {label}
      </span>
      <div className="grid grid-cols-3 gap-3 flex-1">
        {options.map((option) => {
          const selected = value === option;
          return (
            <button
              key={option}
              type="button"
              onClick={() => onChange(option)}
              disabled={disabled}
              className={`rounded-xl border-2 border-black px-3 py-3 font-display text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50 ${
                selected ? "bg-artemis-red text-white" : "bg-white text-black hover:bg-gray-100"
              }`}
            >
              {format(option)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
