"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSendTransaction } from "@privy-io/react-auth";
import {
  encodeFunctionData,
  type Address,
} from "viem";
import { baseSepolia } from "viem/chains";
import { durinRegistrarAbi, DURIN_L2_REGISTRAR_ADDRESS } from "@moonjoy/contracts";

type ClaimStep = "idle" | "checking" | "available" | "preparing" | "signing" | "confirming" | "confirmed" | "failed";

interface EnsClaimFormProps {
  embeddedAddress: string;
  accessToken: string | null;
  onClaimed: (ensName: string) => void;
}

export function EnsClaimForm({ embeddedAddress, accessToken, onClaimed }: EnsClaimFormProps) {
  const [label, setLabel] = useState("");
  const [step, setStep] = useState<ClaimStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const [debouncedLabel, setDebouncedLabel] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { sendTransaction } = useSendTransaction();

  const lowerLabel = label.toLowerCase().trim();
  const isValidLength = lowerLabel.length >= 3;

  const derivedStep: ClaimStep = (() => {
    if (!isValidLength && step !== "preparing" && step !== "signing" && step !== "confirming" && step !== "confirmed") return "idle";
    return step;
  })();

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!lowerLabel || !isValidLength) return;
    debounceRef.current = setTimeout(() => {
      setDebouncedLabel(lowerLabel);
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [lowerLabel, isValidLength]);

  useEffect(() => {
    if (!debouncedLabel || !accessToken) return;
    let cancelled = false;
    (async () => {
      setStep("checking");
      try {
        const res = await fetch("/api/ens/check-availability", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ label: debouncedLabel }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setStep("failed");
          setError(data.error || "Availability check failed");
          return;
        }
        setStep(data.available ? "available" : "failed");
        setError(data.available ? null : "Name is taken");
      } catch {
        if (!cancelled) {
          setStep("failed");
          setError("Failed to check availability");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [debouncedLabel, accessToken]);

  const handleSubmit = useCallback(async () => {
    if (!accessToken || !lowerLabel) return;
    setStep("preparing");
    setError(null);

    try {
      const claimRes = await fetch("/api/ens/claim-user-name", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          label: lowerLabel,
          ownerAddress: embeddedAddress,
        }),
      });
      const claimData = await claimRes.json();
      if (!claimRes.ok) {
        setStep("failed");
        setError(claimData.error || "Reservation failed");
        return;
      }

      setStep("signing");

      const callData = encodeFunctionData({
        abi: durinRegistrarAbi,
        functionName: "register",
        args: [lowerLabel, embeddedAddress as Address],
      });

      const txResult = await sendTransaction(
        {
          to: DURIN_L2_REGISTRAR_ADDRESS as Address,
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

      setStep("confirming");

      const confirmRes = await fetch("/api/ens/confirm-claim", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          label: claimData.label,
          transactionHash: txHash,
        }),
      });
      const confirmData = await confirmRes.json();
      if (!confirmRes.ok) {
        setStep("failed");
        setError(confirmData.error || "Confirmation failed");
        return;
      }

      setStep("confirmed");
      onClaimed(confirmData.ensName);
    } catch (err) {
      setStep("failed");
      setError(err instanceof Error ? err.message : "Transaction failed");
    }
  }, [accessToken, lowerLabel, embeddedAddress, sendTransaction, onClaimed]);

  const isBusy = derivedStep === "checking" || derivedStep === "preparing" || derivedStep === "signing" || derivedStep === "confirming";

  const statusText = (() => {
    if (derivedStep === "checking") return "Checking availability...";
    if (derivedStep === "preparing") return "Preparing claim...";
    if (derivedStep === "signing") return "Sign in your wallet...";
    if (derivedStep === "confirming") return "Verifying onchain...";
    if (derivedStep === "confirmed") return "Name claimed!";
    if (derivedStep === "available") return "Available";
    if (derivedStep === "failed" && error) return error;
    return null;
  })();

  const statusColor = (() => {
    if (derivedStep === "confirmed" || derivedStep === "available") return "text-green-600";
    if (derivedStep === "failed") return "text-artemis-red";
    if (isBusy) return "text-gray-400";
    return "text-gray-400";
  })();

  return (
    <div className="space-y-5">
      <div className="flex gap-3">
        <div className="relative flex-1">
          <input
            type="text"
            value={label}
            onChange={(e) => {
              const v = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "");
              setLabel(v);
              if (derivedStep === "failed" || derivedStep === "confirmed") {
                setStep("idle");
                setError(null);
              }
            }}
            placeholder="pick-a-name"
            disabled={isBusy || derivedStep === "confirmed"}
            maxLength={32}
            className="w-full rounded-xl border-3 border-black px-4 py-3.5 pr-28 font-mono text-base text-black placeholder-gray-400 focus:border-artemis-blue focus:outline-none disabled:opacity-50"
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 font-mono text-xs font-bold text-gray-300">
            .moonjoy.eth
          </span>
        </div>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={derivedStep !== "available" || isBusy}
          className="neo-btn px-6 py-3.5 font-display text-sm font-extrabold uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isBusy ? "..." : "Claim"}
        </button>
      </div>

      {statusText && (
        <p className={`font-label text-xs uppercase tracking-wider ${statusColor}`}>
          {statusText}
        </p>
      )}
    </div>
  );
}
