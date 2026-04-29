"use client";

import { useCallback, useState } from "react";
import { EnsClaimForm } from "@/components/ens-claim-form";
import { EnsUserRecordsForm } from "@/components/ens-user-records-form";
import type { UserEnsStatus } from "@/lib/hooks/use-user-ens-status";
import { extractEnsLabel } from "@/lib/types/ens";

type EnsSetupPhase = "loading" | "no_wallet" | "claim" | "claimed";

interface EnsSetupStatusProps {
  embeddedAddress: string;
  smartAccountAddress: string | null;
  accessToken: string | null;
  ensLoading: boolean;
  ensStatus: UserEnsStatus | null;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="shrink-0 rounded border border-black bg-gray-100 px-2 py-0.5 font-label text-[9px] uppercase tracking-wider text-black transition-colors hover:bg-gray-200"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function EnsSetupStatus({
  accessToken,
  embeddedAddress,
  ensLoading,
  ensStatus,
  smartAccountAddress,
}: EnsSetupStatusProps) {
  const [confirmedEnsName, setConfirmedEnsName] = useState<string | null>(null);

  const userEnsName = confirmedEnsName ?? ensStatus?.userEnsName ?? null;

  const phase: EnsSetupPhase = (() => {
    if (!embeddedAddress) return "no_wallet";
    if (ensLoading) return "loading";
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
    const expectedAgentEnsName = ensStatus?.expectedAgentEnsName ?? `agent-${label}.moonjoy.eth`;
    const agentEnsName = ensStatus?.agentEnsName;
    const agentRegistrationState = ensStatus?.agentRegistrationState ?? "blocked";
    const pendingAgentTransaction = ensStatus?.pendingAgentTransaction;

    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <p className="font-display text-lg font-black uppercase tracking-tighter text-black">
            {label}
          </p>
          <span className="font-mono text-xs font-medium text-gray-400">
            .moonjoy.eth
          </span>
          <CopyButton text={userEnsName} />
          {isMatchReady && (
            <span className="ml-auto rounded-md border border-black bg-artemis-red px-1.5 py-0.5 font-label text-[8px] font-bold uppercase tracking-widest text-white">
              Match Ready
            </span>
          )}
        </div>

        <div className="border-t border-black/10 pt-3">
          <p className="font-label text-[10px] uppercase tracking-wider text-gray-500">
            Agent Identity
          </p>
          <div className="mt-1 space-y-1">
            <p className="font-body text-xs text-black">
              {agentEnsName ?? expectedAgentEnsName}
            </p>
            {agentRegistrationState === "ready" ? (
              <p className="font-body text-xs text-gray-500">
                Registered onchain to the agent smart wallet.
              </p>
            ) : agentRegistrationState === "pending" ? (
              <div className="space-y-1">
                <p className="font-body text-xs text-gray-500">
                  Registration is pending onchain. This panel refreshes automatically while the account-abstracted transaction settles.
                </p>
                {pendingAgentTransaction?.txHash ? (
                  <p className="font-mono text-[10px] text-gray-400">
                    tx {pendingAgentTransaction.txHash}
                  </p>
                ) : null}
                {pendingAgentTransaction?.userOperationHash ? (
                  <p className="font-mono text-[10px] text-gray-400">
                    uo {pendingAgentTransaction.userOperationHash}
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="space-y-1">
                <p className="font-body text-xs text-gray-500">
                  The agent registers this name from the smart wallet after your human ENS claim authorizes it.
                </p>
                <ol className="ml-4 list-decimal space-y-1 font-body text-xs text-gray-500">
                  <li>Approve the Moonjoy MCP client again.</li>
                  <li>Connect the agent client.</li>
                  <li>Run bootstrap. The agent should call `moonjoy_run_bootstrap` and claim its ENS name.</li>
                  <li>If a transaction returns pending, wait for confirmation and run the bootstrap step again.</li>
                </ol>
              </div>
            )}
          </div>
        </div>

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

  if (phase === "claim" && embeddedAddress && accessToken && smartAccountAddress) {
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
            smartAccountAddress={smartAccountAddress}
            accessToken={accessToken}
            onClaimed={setConfirmedEnsName}
          />
        </div>
      </div>
    );
  }

  if (embeddedAddress && !smartAccountAddress) {
    return (
      <div className="neo-well px-4 py-6 text-center">
        <p className="font-body text-sm text-gray-500">
          Waiting for the agent smart wallet. Human ENS claim unlocks after the smart wallet is ready.
        </p>
      </div>
    );
  }

  return null;
}
