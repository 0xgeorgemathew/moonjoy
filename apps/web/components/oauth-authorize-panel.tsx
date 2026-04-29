"use client";

import { useLogin, usePrivy, useSessionSigners } from "@privy-io/react-auth";
import { useEffect, useState } from "react";
import type { OAuthAuthorizeParams } from "@/lib/services/mcp-oauth-service";
import { useAuthState } from "@/lib/hooks/use-auth-state";

export function OAuthAuthorizePanel({
  params,
  clientName,
  error,
}: {
  params: OAuthAuthorizeParams;
  clientName: string;
  error: string | null;
}) {
  const { authenticated, getAccessToken, ready } = usePrivy();
  const { addSessionSigners } = useSessionSigners();
  const { login } = useLogin();
  const { embeddedAddress, smartAccountAddress } = useAuthState();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(error);
  const [privyTimedOut, setPrivyTimedOut] = useState(false);

  useEffect(() => {
    if (ready) return;

    const timer = window.setTimeout(() => {
      setPrivyTimedOut(true);
    }, 6000);

    return () => window.clearTimeout(timer);
  }, [ready]);

  async function approve() {
    setPending(true);
    setMessage(null);

    try {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error("Sign in before approving Moonjoy MCP.");
      if (!embeddedAddress) {
        throw new Error("Embedded signer is not ready yet. Reload and try again.");
      }
      if (!smartAccountAddress) {
        throw new Error(
          "Agent smart wallet is not ready yet. Reload and try again.",
        );
      }

      const executionResponse = await fetch("/api/mcp/oauth/authorize/execution", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const executionBody = (await executionResponse
        .json()
        .catch(() => ({}))) as {
        executionSignerId?: string;
        executionWalletId?: string;
        executionWalletAddress?: string;
        executionKeyCiphertext?: string;
        executionKeyExpiresAt?: string;
        error?: string;
      };

      if (
        !executionResponse.ok ||
        !executionBody.executionSignerId ||
        !executionBody.executionWalletId ||
        !executionBody.executionWalletAddress ||
        !executionBody.executionKeyCiphertext ||
        !executionBody.executionKeyExpiresAt
      ) {
        throw new Error(
          executionBody.error ?? "Failed to prepare smart-wallet execution authority.",
        );
      }

      await addSessionSigners({
        address: executionBody.executionWalletAddress,
        signers: [{ signerId: executionBody.executionSignerId, policyIds: [] }],
      });

      const response = await fetch("/api/mcp/oauth/authorize/approve", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          ...params,
          executionAuthorization: {
            executionSignerId: executionBody.executionSignerId,
            executionWalletId: executionBody.executionWalletId,
            executionKeyCiphertext: executionBody.executionKeyCiphertext,
            executionKeyExpiresAt: executionBody.executionKeyExpiresAt,
          },
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        redirectUrl?: string;
        error?: string;
      };

      if (!response.ok || !body.redirectUrl) {
        throw new Error(body.error ?? "Failed to approve Moonjoy MCP.");
      }

      window.location.assign(body.redirectUrl);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Approval failed");
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-surface px-4 py-8">
      <section className="neo-panel animate-fade-in-up w-full max-w-xl p-6 sm:p-10">
        <p className="font-label text-[10px] font-bold uppercase tracking-wider text-gray-500">
          Moonjoy MCP
        </p>
        <h1 className="mt-3 font-display text-3xl font-black uppercase leading-tight tracking-tight text-black sm:text-4xl">
          Approve Agent Client
        </h1>

        <div className="neo-well mt-6 grid gap-2 p-4">
          <p className="font-label text-xs uppercase tracking-wider">
            <span className="text-gray-500">Client:</span>{" "}
            <span className="font-semibold text-black">{clientName}</span>
          </p>
          <p className="font-label text-xs uppercase tracking-wider">
            <span className="text-gray-500">Scopes:</span>{" "}
            <span className="font-semibold text-black">
              {params.scope ?? "moonjoy:read moonjoy:agent"}
            </span>
          </p>
        </div>

        {message ? (
          <p className="mt-5 font-label text-xs font-bold uppercase tracking-wider text-artemis-red">
            {message}
          </p>
        ) : null}

        {!ready ? (
          <div className="mt-6 grid gap-2">
            <p className="font-label text-xs uppercase tracking-wider text-gray-500">
              Loading Privy session…
            </p>
            {privyTimedOut ? (
              <p className="font-label text-xs font-bold uppercase tracking-wider text-artemis-red">
                Privy is still not ready. Restart the dev server after the Next
                config change, then reload this authorization page.
              </p>
            ) : null}
          </div>
        ) : authenticated ? (
          <button
            type="button"
            onClick={approve}
            disabled={pending || Boolean(error)}
            className="neo-btn mt-6 px-8 py-4 font-display text-sm font-extrabold uppercase tracking-[0.15em] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "Approving…" : "Approve Moonjoy MCP"}
          </button>
        ) : (
          <button
            type="button"
            onClick={login}
            className="neo-btn mt-6 px-8 py-4 font-display text-sm font-extrabold uppercase tracking-[0.15em]"
          >
            Sign In With Privy
          </button>
        )}
      </section>
    </main>
  );
}
