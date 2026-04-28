"use client";

import { useEffect, useState, useCallback } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { EnsClaimForm } from "@/components/ens-claim-form";
import { EnsUserRecordsForm } from "@/components/ens-user-records-form";
import { extractEnsLabel } from "@/lib/types/ens";

type EnsSetupPhase = "loading" | "no_wallet" | "claim" | "claimed";

interface EnsStatus {
  userEnsName: string | null;
  embeddedSignerAddress: string | null;
  textRecords: { record_key: string; record_value: string }[];
}

interface EnsSetupStatusProps {
  embeddedAddress: string;
  smartAccountAddress: string;
}

function CopyAddress({ label, address }: { label: string; address: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [address]);

  const truncated = `${address.slice(0, 6)}...${address.slice(-4)}`;

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border-2 border-black bg-white px-3 py-2">
      <div className="min-w-0">
        <span className="block font-label text-[10px] uppercase tracking-wider text-gray-500">
          {label}
        </span>
        <p className="truncate font-mono text-xs text-black">{address}</p>
      </div>
      <button
        type="button"
        onClick={handleCopy}
        className="shrink-0 rounded border-2 border-black bg-gray-100 px-2 py-1 font-label text-[9px] uppercase tracking-wider text-black transition-colors hover:bg-gray-200"
      >
        {copied ? "Copied" : truncated}
      </button>
    </div>
  );
}

export function EnsSetupStatus({ embeddedAddress, smartAccountAddress }: EnsSetupStatusProps) {
  const { getAccessToken } = usePrivy();
  const [ensStatus, setEnsStatus] = useState<EnsStatus | null>(null);
  const [ensLoading, setEnsLoading] = useState(true);
  const [confirmedEnsName, setConfirmedEnsName] = useState<string | null>(null);

  const userEnsName = confirmedEnsName ?? ensStatus?.userEnsName ?? null;

  useEffect(() => {
    if (!embeddedAddress) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        if (!token || cancelled) return;
        const res = await fetch("/api/ens/status", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok || cancelled) return;
        const data: EnsStatus = await res.json();
        setEnsStatus(data);
      } catch {
      } finally {
        if (!cancelled) setEnsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [embeddedAddress, getAccessToken]);

  const [accessToken, setAccessToken] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        if (!cancelled) setAccessToken(token);
      } catch {
      }
    })();
    return () => { cancelled = true; };
  }, [getAccessToken]);

  const phase: EnsSetupPhase = (() => {
    if (ensLoading) return "loading";
    if (!embeddedAddress) return "no_wallet";
    if (userEnsName) return "claimed";
    return "claim";
  })();

  if (phase === "loading") {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-2 w-2 animate-pulse rounded-full bg-artemis-charcoal" />
      </div>
    );
  }

  if (phase === "no_wallet") {
    return (
      <div className="neo-well px-4 py-6 text-center">
        <p className="font-body text-sm text-gray-500">
          Complete wallet setup in Settings first.
        </p>
      </div>
    );
  }

  if (phase === "claimed" && userEnsName) {
    const label = extractEnsLabel(userEnsName);
    const isMatchReady = !!(userEnsName && smartAccountAddress);

    return (
      <div className="space-y-8">
        <div className="neo-card px-6 py-6">
          <p className="font-display text-4xl font-black uppercase tracking-tighter text-black">
            {label}
          </p>
          <p className="mt-1 font-mono text-sm font-medium text-gray-400">
            .moonjoy.eth
          </p>

          {isMatchReady && (
            <div className="mt-4">
              <span className="neo-badge text-[9px]">
                Match Ready
              </span>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <p className="font-label text-[10px] uppercase tracking-wider text-gray-500">
            Wallets
          </p>
          {embeddedAddress && (
            <CopyAddress label="Signer" address={embeddedAddress} />
          )}
          {smartAccountAddress && (
            <CopyAddress label="Smart Account" address={smartAccountAddress} />
          )}
        </div>

        <hr className="neo-divider" />

        <div className="neo-well px-4 py-4">
          <p className="font-label text-[10px] uppercase tracking-wider text-gray-500">
            Agent Identity
          </p>
          <p className="mt-1 font-body text-xs text-gray-400">
            agent-{label}.moonjoy.eth — coming soon
          </p>
        </div>

        <hr className="neo-divider" />

        {ensStatus && (
          <EnsUserRecordsForm
            ensName={userEnsName}
            label={label}
            embeddedAddress={embeddedAddress}
            existingRecords={ensStatus.textRecords}
          />
        )}
      </div>
    );
  }

  if (phase === "claim" && embeddedAddress && accessToken) {
    return (
      <div className="mx-auto max-w-md">
        <div className="neo-card px-6 py-8">
          <div className="mb-6 text-center">
            <p className="font-display text-2xl font-black uppercase tracking-tighter text-black">
              Pick Your Name
            </p>
            <p className="mt-2 font-body text-sm text-gray-500">
              Your ENS name is your identity on Moonjoy. Other players will see it in matches.
            </p>
          </div>
          <EnsClaimForm
            embeddedAddress={embeddedAddress}
            accessToken={accessToken}
            onClaimed={setConfirmedEnsName}
          />
        </div>
      </div>
    );
  }

  return null;
}
