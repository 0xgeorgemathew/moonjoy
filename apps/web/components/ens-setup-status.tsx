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

function CopyButton({ text, className = "" }: { text: string; className?: string }) {
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
      className={`shrink-0 rounded-lg border-2 border-black bg-white px-2.5 py-1 font-label text-[9px] font-bold uppercase tracking-wider text-black shadow-[2px_2px_0_0_var(--artemis-blue)] transition-all hover:shadow-[1px_1px_0_0_var(--artemis-blue)] hover:translate-x-[1px] hover:translate-y-[1px] active:shadow-none active:translate-x-[2px] active:translate-y-[2px] ${className}`}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function AddressRow({ label, address }: { label: string; address: string | null }) {
  if (!address) return null;
  return (
    <div className="flex items-baseline gap-2">
      <span className="shrink-0 font-label text-[9px] uppercase tracking-widest text-artemis-silver">
        {label}
      </span>
      <p className="truncate font-mono text-[11px] text-artemis-charcoal">{address}</p>
    </div>
  );
}

function AgentStatusBadge({ state }: { state: string }) {
  if (state === "ready") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg border-2 border-black bg-green-50 px-2.5 py-1 font-label text-[10px] font-bold uppercase tracking-wider text-green-700 shadow-[2px_2px_0_0_var(--artemis-blue)]">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
        Registered
      </span>
    );
  }
  if (state === "pending") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg border-2 border-black bg-amber-50 px-2.5 py-1 font-label text-[10px] font-bold uppercase tracking-wider text-amber-700 shadow-[2px_2px_0_0_var(--artemis-blue)]">
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
        Pending
      </span>
    );
  }
  if (state === "action_required") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg border-2 border-black bg-amber-50 px-2.5 py-1 font-label text-[10px] font-bold uppercase tracking-wider text-amber-700 shadow-[2px_2px_0_0_var(--artemis-blue)]">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
        Action Required
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border-2 border-black bg-gray-50 px-2.5 py-1 font-label text-[10px] font-bold uppercase tracking-wider text-artemis-charcoal shadow-[2px_2px_0_0_var(--artemis-blue)]">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-artemis-silver" />
      Awaiting Setup
    </span>
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
  const [agentDetailsOpen, setAgentDetailsOpen] = useState(false);

  const userEnsName = confirmedEnsName ?? ensStatus?.userEnsName ?? null;

  const phase: EnsSetupPhase = (() => {
    if (!embeddedAddress) return "no_wallet";
    if (ensLoading) return "loading";
    if (userEnsName) return "claimed";
    return "claim";
  })();

  if (phase === "loading") {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16">
        <div className="h-3 w-3 animate-pulse rounded-full bg-artemis-charcoal" />
        <p className="font-label text-[11px] uppercase tracking-widest text-artemis-charcoal">
          Resolving identity
        </p>
      </div>
    );
  }

  if (phase === "no_wallet") {
    return (
      <div className="rounded-xl border-3 border-black bg-white px-5 py-8 text-center shadow-[3px_3px_0_0_var(--artemis-red)]">
        <p className="font-display text-sm font-bold uppercase tracking-wider text-artemis-red">
          No wallet found
        </p>
        <p className="mt-2 font-body text-xs text-gray-500">
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
      <div className="space-y-4">
        {/* ── User Identity Card ── */}
        <div className="rounded-xl border-3 border-black bg-white shadow-[4px_4px_0_0_var(--artemis-blue)]">
          <div className="border-b-2 border-black/10 bg-gray-50/50 px-5 py-3">
            <div className="flex items-center gap-2">
              <svg viewBox="0 0 24 24" className="h-4 w-4 text-artemis-charcoal" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              <span className="font-label text-[10px] font-bold uppercase tracking-widest text-artemis-charcoal">
                Player Identity
              </span>
              {isMatchReady && (
                <span className="ml-auto rounded-lg border-2 border-black bg-artemis-red px-2 py-0.5 font-label text-[9px] font-bold uppercase tracking-widest text-white shadow-[2px_2px_0_0_var(--artemis-blue)]">
                  Match Ready
                </span>
              )}
            </div>
          </div>

          <div className="px-5 py-4">
            <div className="flex items-baseline gap-1.5">
              <p className="font-display text-3xl font-black uppercase tracking-tighter text-black">
                {label}
              </p>
              <span className="font-mono text-sm font-medium text-gray-300">
                .moonjoy.eth
              </span>
              <CopyButton text={userEnsName} className="ml-2" />
            </div>

            <div className="mt-4 space-y-1.5 border-t-2 border-dashed border-black/10 pt-3">
              <AddressRow label="Signer" address={embeddedAddress} />
              <AddressRow label="Agent Wallet" address={smartAccountAddress} />
            </div>
          </div>
        </div>

        {/* ── Agent Identity Section ── */}
        <div className="rounded-xl border-3 border-black bg-white shadow-[4px_4px_0_0_var(--artemis-blue)]">
          <div className="border-b-2 border-black/10 bg-gray-50/50 px-5 py-3">
            <div className="flex items-center gap-2">
              <svg viewBox="0 0 24 24" className="h-4 w-4 text-artemis-charcoal" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
              </svg>
              <span className="font-label text-[10px] font-bold uppercase tracking-widest text-artemis-charcoal">
                Agent Identity
              </span>
              <div className="ml-auto">
                <AgentStatusBadge state={agentRegistrationState} />
              </div>
            </div>
          </div>

          <div className="px-5 py-4">
            <div className="flex items-baseline gap-1.5">
              <p className="font-display text-base font-black uppercase tracking-tighter text-black">
                {agentEnsName ?? expectedAgentEnsName}
              </p>
              {agentEnsName && (
                <CopyButton text={agentEnsName} />
              )}
            </div>

            {agentRegistrationState === "ready" && (
              <p className="mt-2 font-body text-xs text-gray-500">
                Registered onchain to the agent smart wallet.
              </p>
            )}

            {agentRegistrationState === "pending" && (
              <div className="mt-3 space-y-2">
                <p className="font-body text-xs text-gray-500">
                  Registration is pending onchain. This panel refreshes automatically while the transaction settles.
                </p>
                {pendingAgentTransaction?.txHash && (
                  <div className="flex items-baseline gap-2">
                    <span className="shrink-0 font-label text-[9px] uppercase tracking-widest text-artemis-silver">tx</span>
                    <p className="truncate font-mono text-[10px] text-gray-400">{pendingAgentTransaction.txHash}</p>
                  </div>
                )}
                {pendingAgentTransaction?.userOperationHash && (
                  <div className="flex items-baseline gap-2">
                    <span className="shrink-0 font-label text-[9px] uppercase tracking-widest text-artemis-silver">uo</span>
                    <p className="truncate font-mono text-[10px] text-gray-400">{pendingAgentTransaction.userOperationHash}</p>
                  </div>
                )}
              </div>
            )}

            {(agentRegistrationState === "blocked" || agentRegistrationState === "action_required") && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setAgentDetailsOpen(!agentDetailsOpen)}
                  className="flex items-center gap-1.5 font-label text-[10px] font-bold uppercase tracking-wider text-artemis-blue transition-colors hover:text-artemis-blue-light"
                >
                  <svg viewBox="0 0 24 24" className={`h-3 w-3 transition-transform ${agentDetailsOpen ? "rotate-90" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                  {agentDetailsOpen ? "Hide" : "Setup Instructions"}
                </button>
                {agentDetailsOpen && (
                  <div className="mt-3 space-y-2 rounded-lg border-2 border-dashed border-black/15 bg-gray-50 p-3">
                    <p className="font-body text-xs text-gray-500">
                      The agent registers this name from the smart wallet after your ENS claim authorizes it.
                    </p>
                    <ol className="ml-4 list-decimal space-y-1 font-body text-xs text-gray-500">
                      <li>Approve the Moonjoy MCP client again.</li>
                      <li>Connect the agent client.</li>
                      <li>Run bootstrap. The agent calls <code className="rounded bg-gray-100 px-1 font-mono text-[10px]">moonjoy_run_bootstrap</code> to claim its ENS name.</li>
                      <li>If a transaction returns pending, wait for confirmation and run the bootstrap step again.</li>
                    </ol>
                  </div>
                )}
              </div>
            )}

            {ensStatus?.agentStats && (
              <div className="mt-4 grid grid-cols-2 gap-3 border-t-2 border-dashed border-black/10 pt-3">
                <AgentStatTile label="Matches" value={String(ensStatus.agentStats.matchesPlayed)} />
                <AgentStatTile label="Streak" value={String(ensStatus.agentStats.streak)} />
                {ensStatus.agentStats.syncing && (
                  <p className="col-span-2 font-label text-[9px] font-bold uppercase tracking-widest text-artemis-silver">
                    Stats syncing
                  </p>
                )}
              </div>
            )}

            {(ensStatus?.activeStrategies.public || ensStatus?.activeStrategies.secretSauce) && (
              <div className="mt-4 border-t-2 border-dashed border-black/10 pt-3">
                <p className="font-label text-[9px] font-bold uppercase tracking-widest text-artemis-silver">
                  Active Strategy
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <StrategyStatusCard
                    label="Public"
                    name={ensStatus.activeStrategies.public?.name ?? "None"}
                    detail={ensStatus.activeStrategies.public ? "Readable from ENS + 0G." : "No active public strategy."}
                    tone="blue"
                  />
                  <StrategyStatusCard
                    label="Secret Sauce"
                    name={ensStatus.activeStrategies.secretSauce?.name ?? "None"}
                    detail={ensStatus.activeStrategies.secretSauce ? "Encrypted at rest. MCP-only read path." : "No active secret strategy."}
                    tone="red"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Matchmaking Preferences ── */}
        {ensStatus && (
          <div className="rounded-xl border-3 border-black bg-white shadow-[4px_4px_0_0_var(--artemis-blue)]">
            <div className="border-b-2 border-black/10 bg-gray-50/50 px-5 py-3">
              <div className="flex items-center gap-2">
                <svg viewBox="0 0 24 24" className="h-4 w-4 text-artemis-charcoal" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <circle cx="12" cy="12" r="6" />
                  <circle cx="12" cy="12" r="2" />
                </svg>
                <span className="font-label text-[10px] font-bold uppercase tracking-widest text-artemis-charcoal">
                  Matchmaking Preferences
                </span>
              </div>
            </div>

            <div className="px-5 py-4">
              <EnsUserRecordsForm
                ensName={userEnsName}
                label={label}
                embeddedAddress={embeddedAddress}
                existingRecords={ensStatus.textRecords}
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  if (phase === "claim" && embeddedAddress && accessToken && smartAccountAddress) {
    return (
      <div className="rounded-xl border-3 border-black bg-white shadow-[4px_4px_0_0_var(--artemis-blue)]">
        <div className="border-b-2 border-black/10 bg-gray-50/50 px-5 py-3">
          <div className="flex items-center gap-2">
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-artemis-charcoal" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            <span className="font-label text-[10px] font-bold uppercase tracking-widest text-artemis-charcoal">
              Identity Setup
            </span>
          </div>
        </div>

        <div className="px-6 py-8">
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
      <div className="rounded-xl border-3 border-black bg-white px-5 py-8 text-center shadow-[3px_3px_0_0_var(--artemis-blue)]">
        <p className="font-display text-sm font-bold uppercase tracking-wider text-artemis-charcoal">
          Waiting for agent wallet
        </p>
        <p className="mt-2 font-body text-xs text-gray-500">
          Human ENS claim unlocks after the smart wallet is ready.
        </p>
      </div>
    );
  }

  return null;
}

function AgentStatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border-2 border-black bg-gray-50 px-3 py-2 shadow-[2px_2px_0_0_var(--artemis-blue)]">
      <p className="font-display text-2xl font-black leading-none text-black">
        {value}
      </p>
      <p className="mt-1 font-label text-[8px] font-bold uppercase tracking-widest text-artemis-silver">
        {label}
      </p>
    </div>
  );
}

function StrategyStatusCard({
  label,
  name,
  detail,
  tone,
}: {
  label: string;
  name: string;
  detail: string;
  tone: "blue" | "red";
}) {
  const shadow =
    tone === "red"
      ? "shadow-[3px_3px_0_0_var(--artemis-red)]"
      : "shadow-[3px_3px_0_0_var(--artemis-blue)]";

  return (
    <div className={`rounded-xl border-2 border-black bg-white px-3 py-3 ${shadow}`}>
      <p className="font-label text-[9px] font-bold uppercase tracking-widest text-artemis-silver">
        {label}
      </p>
      <p className="mt-1 font-display text-sm font-black uppercase tracking-tight text-black">
        {name}
      </p>
      <p className="mt-1 font-body text-[11px] text-gray-500">{detail}</p>
    </div>
  );
}
