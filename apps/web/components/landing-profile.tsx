"use client";

import { useAuthState } from "@/lib/hooks/use-auth-state";
import { EnsSetupStatus } from "./ens-setup-status";

export function LandingProfile() {
  const { setupStatus, embeddedAddress, smartAccountAddress } = useAuthState();

  return (
    <div className="flex min-h-[200px] flex-1 flex-col overflow-y-auto p-5 sm:p-10">
      <h2 className="font-display text-xl font-black uppercase tracking-tight text-black">
        Identity
      </h2>
      <p className="mt-1 font-body text-xs text-gray-500">
        Your Moonjoy name on the ENS namespace
      </p>

      <div className="mt-8">
        {setupStatus === "loading" && (
          <div className="flex items-center justify-center py-16">
            <div className="h-2 w-2 animate-pulse rounded-full bg-artemis-charcoal" />
          </div>
        )}
        {setupStatus === "onboarding" && (
          <div className="neo-well px-4 py-6 text-center">
            <p className="font-body text-sm text-gray-500">
              Setting up your agent wallet...
            </p>
          </div>
        )}
        {setupStatus === "error" && (
          <div className="neo-well px-4 py-6 text-center">
            <p className="font-body text-sm text-artemis-red">
              Wallet setup needs attention. Open Settings to retry.
            </p>
          </div>
        )}
        {setupStatus === "complete" && (
          <EnsSetupStatus
            embeddedAddress={embeddedAddress ?? ""}
            smartAccountAddress={smartAccountAddress ?? ""}
          />
        )}
      </div>
    </div>
  );
}
