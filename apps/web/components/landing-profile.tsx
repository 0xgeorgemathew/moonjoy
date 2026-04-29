"use client";

import { useAuthState } from "@/lib/hooks/use-auth-state";
import type { UserEnsStatus } from "@/lib/hooks/use-user-ens-status";
import { EnsSetupStatus } from "./ens-setup-status";

export function LandingProfile({
  accessToken,
  ensLoading,
  ensStatus,
}: {
  accessToken: string | null;
  ensLoading: boolean;
  ensStatus: UserEnsStatus | null;
}) {
  const { error, setupStatus, embeddedAddress, smartAccountAddress } = useAuthState();
  const hasEmbeddedAddress = Boolean(embeddedAddress);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto p-4 sm:p-6 lg:px-8 lg:py-5">
      <h2 className="font-display text-xl font-black uppercase tracking-tight text-black">
        Identity
      </h2>
      <p className="mt-1 font-body text-[11px] text-gray-500">
        Your Moonjoy name on the ENS namespace
      </p>

      <div className="mt-4">
        {!hasEmbeddedAddress && setupStatus === "loading" && (
          <div className="flex items-center justify-center py-16">
            <div className="h-2 w-2 animate-pulse rounded-full bg-artemis-charcoal" />
          </div>
        )}
        {!hasEmbeddedAddress && setupStatus === "onboarding" && (
          <div className="neo-well px-4 py-6 text-center">
            <p className="font-body text-sm text-gray-500">
              Setting up your agent wallet...
            </p>
          </div>
        )}
        {!hasEmbeddedAddress && setupStatus === "error" && (
          <div className="neo-well px-4 py-6 text-center">
            <p className="font-body text-sm text-artemis-red">
              {error ?? "Wallet setup needs attention. Open Settings to retry."}
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
  );
}
