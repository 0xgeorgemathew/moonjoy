"use client";

import { useAuthState } from "@/lib/hooks/use-auth-state";
import type { UserEnsStatus } from "@/lib/hooks/use-user-ens-status";
import { EnsSetupStatus } from "./ens-setup-status";

export function LandingProfile({
  accessToken,
  ensLoading,
  ensStatus,
  embeddedAddress: externalEmbedded,
  smartAccountAddress: externalSmartAccount,
}: {
  accessToken: string | null;
  ensLoading: boolean;
  ensStatus: UserEnsStatus | null;
  embeddedAddress: string | null;
  smartAccountAddress: string | null;
}) {
  const { error, setupStatus, embeddedAddress: authEmbedded, smartAccountAddress: authSmartAccount } = useAuthState();
  const embeddedAddress = externalEmbedded ?? authEmbedded;
  const smartAccountAddress = externalSmartAccount ?? authSmartAccount;
  const hasEmbeddedAddress = Boolean(embeddedAddress);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[#fafaf8]">
      <header className="flex items-center justify-between border-b-3 border-black bg-white px-5 py-3">
        <div className="flex items-center gap-3">
          <h1 className="font-display text-lg font-black uppercase tracking-tight text-black">
            Profile
          </h1>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-lg space-y-4 p-5 lg:p-8">
          {!hasEmbeddedAddress && setupStatus === "loading" && (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <div className="h-3 w-3 animate-pulse rounded-full bg-artemis-charcoal" />
              <p className="font-label text-[11px] uppercase tracking-widest text-artemis-charcoal">
                Loading
              </p>
            </div>
          )}

          {!hasEmbeddedAddress && setupStatus === "onboarding" && (
            <div className="rounded-xl border-3 border-black bg-white px-5 py-8 text-center shadow-[3px_3px_0_0_var(--artemis-blue)]">
              <p className="font-display text-sm font-bold uppercase tracking-wider text-artemis-charcoal">
                Setting up your agent wallet...
              </p>
              <p className="mt-2 font-body text-xs text-gray-400">
                This usually takes a few seconds.
              </p>
            </div>
          )}

          {!hasEmbeddedAddress && setupStatus === "error" && (
            <div className="rounded-xl border-3 border-black bg-white px-5 py-8 text-center shadow-[3px_3px_0_0_var(--artemis-red)]">
              <p className="font-display text-sm font-bold uppercase tracking-wider text-artemis-red">
                {error ?? "Wallet setup needs attention"}
              </p>
              <p className="mt-2 font-body text-xs text-gray-500">
                Open Settings to retry.
              </p>
            </div>
          )}

          {embeddedAddress && (
            <EnsSetupStatus
              accessToken={accessToken}
              embeddedAddress={embeddedAddress}
              ensLoading={ensLoading}
              ensStatus={ensStatus}
              smartAccountAddress={smartAccountAddress}
            />
          )}
        </div>
      </div>
    </div>
  );
}
