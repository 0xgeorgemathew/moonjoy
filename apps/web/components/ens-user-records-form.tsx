"use client";

import { useCallback, useMemo, useState } from "react";
import { useWallets, useSendTransaction, usePrivy } from "@privy-io/react-auth";
import { type Address } from "viem";
import { encodeFunctionData } from "viem";
import { baseSepolia } from "viem/chains";
import { durinRegistryAbi, DURIN_L2_REGISTRY_ADDRESS } from "@moonjoy/contracts";
import { getNameNode } from "@/lib/services/ens-service";

type PreferenceStatus = "idle" | "signing" | "confirming" | "confirmed" | "failed";
type MatchDuration = "any" | 3 | 5 | 10;
type WagerUsd = 10 | 25 | 50;
type TradingCapitalUsd = "any" | 100 | 250 | 500;

interface MatchPreference {
  durationMinutes: MatchDuration;
  wagerUsd: WagerUsd;
  capitalMinUsd: TradingCapitalUsd;
  capitalMaxUsd: TradingCapitalUsd;
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
  capitalMinUsd: "any",
  capitalMaxUsd: 250,
};

const DURATION_OPTIONS: readonly MatchDuration[] = ["any", 3, 5, 10];
const WAGER_OPTIONS: readonly WagerUsd[] = [10, 25, 50];
const CAPITAL_OPTIONS: readonly TradingCapitalUsd[] = ["any", 100, 250, 500];

function normalizePreference(preference: MatchPreference): MatchPreference {
  const { capitalMinUsd, capitalMaxUsd } = preference;
  if (
    capitalMinUsd !== "any" &&
    capitalMaxUsd !== "any" &&
    capitalMinUsd > capitalMaxUsd
  ) {
    return {
      ...preference,
      capitalMaxUsd: capitalMinUsd,
    };
  }

  return preference;
}

function stringifyPreference(preference: MatchPreference): string {
  return JSON.stringify({
    duration:
      preference.durationMinutes === "any"
        ? "any"
        : String(preference.durationMinutes * 60),
    wagerUsd: String(preference.wagerUsd),
    capitalUsd: {
      min:
        preference.capitalMinUsd === "any"
          ? "any"
          : String(preference.capitalMinUsd),
      max:
        preference.capitalMaxUsd === "any"
          ? "any"
          : String(preference.capitalMaxUsd),
    },
  });
}

function parseDuration(value: unknown): MatchDuration {
  if (value === "any") return "any";
  if (value === "180") return 3;
  if (value === "300") return 5;
  if (value === "600") return 10;
  if (value === "3m") return 3;
  if (value === "5m") return 5;
  if (value === "10m") return 10;
  if (DURATION_OPTIONS.includes(value as MatchDuration)) return value as MatchDuration;
  return DEFAULT_PREFERENCE.durationMinutes;
}

function parseWager(value: unknown): WagerUsd {
  if (value === "10") return 10;
  if (value === "25") return 25;
  if (value === "50") return 50;
  if (WAGER_OPTIONS.includes(value as WagerUsd)) return value as WagerUsd;
  return DEFAULT_PREFERENCE.wagerUsd;
}

function parseCapital(
  value: unknown,
  fallback: TradingCapitalUsd = DEFAULT_PREFERENCE.capitalMaxUsd,
): TradingCapitalUsd {
  if (value === "any") return "any";
  if (value === "100") return 100;
  if (value === "250") return 250;
  if (value === "500") return 500;
  if (CAPITAL_OPTIONS.includes(value as TradingCapitalUsd)) return value as TradingCapitalUsd;
  return fallback;
}

function preferenceFromRecord(recordValue: string | undefined): MatchPreference {
  if (!recordValue) return DEFAULT_PREFERENCE;

  try {
    const parsed = JSON.parse(recordValue) as {
      duration?: unknown;
      durationMinutes?: unknown;
      wagerUsd?: unknown;
      tradingCapitalUsd?: unknown;
      capitalUsd?: {
        min?: unknown;
        max?: unknown;
      };
    };
      const legacyCapital = parseCapital(
        parsed.tradingCapitalUsd,
        DEFAULT_PREFERENCE.capitalMaxUsd,
      );
    return {
      durationMinutes: parseDuration(parsed.durationMinutes ?? parsed.duration),
      wagerUsd: parseWager(parsed.wagerUsd),
      capitalMinUsd: parseCapital(
        parsed.capitalUsd?.min,
        DEFAULT_PREFERENCE.capitalMinUsd,
      ),
      capitalMaxUsd: parseCapital(
        parsed.capitalUsd?.max,
        legacyCapital === "any"
          ? DEFAULT_PREFERENCE.capitalMaxUsd
          : legacyCapital,
      ),
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
    const next = normalizePreference({ ...preference, ...update });
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
    <div className="space-y-2">
      <p className="font-display text-sm font-bold uppercase tracking-wider text-black">
        Matchmaking Preferences
      </p>

      <div className="space-y-1">
        <PreferenceButtonGroup
          label="Duration"
          value={preference.durationMinutes}
          options={DURATION_OPTIONS}
          format={(value) => (value === "any" ? "Any" : `${value}m`)}
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
          label="Min"
          value={preference.capitalMinUsd}
          options={CAPITAL_OPTIONS}
          format={formatCapitalOption}
          disabled={isBusy}
          onChange={(capitalMinUsd) => updatePreference({ capitalMinUsd })}
        />
        <PreferenceButtonGroup
          label="Max"
          value={preference.capitalMaxUsd}
          options={CAPITAL_OPTIONS}
          format={formatCapitalOption}
          disabled={isBusy}
          onChange={(capitalMaxUsd) => updatePreference({ capitalMaxUsd })}
        />
      </div>

      <button
        type="button"
        onClick={handleSave}
        disabled={isBusy || isSaved}
        className="self-start rounded-lg border-2 border-black bg-white px-4 py-1.5 font-display text-base font-bold uppercase tracking-wider shadow-[3px_3px_0_0_var(--artemis-blue)] transition-all disabled:cursor-not-allowed disabled:opacity-40 hover:shadow-[1px_1px_0_0_var(--artemis-blue)] hover:translate-x-[2px] hover:translate-y-[2px] active:shadow-none active:translate-x-[3px] active:translate-y-[3px]"
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

function formatCapitalOption(value: TradingCapitalUsd): string {
  return value === "any" ? "Any" : `$${value}`;
}

function PreferenceButtonGroup<T extends string | number>({
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
    <div className="flex items-center gap-3">
      <span className="w-14 shrink-0 font-label text-[10px] uppercase tracking-wider text-gray-500">
        {label}
      </span>
      <div className={`grid gap-1.5 ${options.length > 3 ? "grid-cols-4" : "grid-cols-3"}`}>
        {options.map((option) => {
          const selected = value === option;
          return (
            <button
              key={option}
              type="button"
              onClick={() => onChange(option)}
              disabled={disabled}
              className={`rounded-lg border-2 border-black px-2 py-1 font-display text-sm font-bold uppercase tracking-tight shadow-[2px_2px_0_0_var(--artemis-blue)] transition-all disabled:opacity-50 active:shadow-none active:translate-x-[2px] active:translate-y-[2px] ${
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
