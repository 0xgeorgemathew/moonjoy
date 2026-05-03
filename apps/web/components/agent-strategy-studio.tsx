"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { encodeFunctionData, type Address } from "viem";
import { baseSepolia } from "viem/chains";
import { durinRegistryAbi, DURIN_L2_REGISTRY_ADDRESS } from "@moonjoy/contracts";
import { useAuthState } from "@/lib/hooks/use-auth-state";
import { useUserEnsStatus } from "@/lib/hooks/use-user-ens-status";
import { extractEnsLabel } from "@/lib/types/ens";
import { getNameNode } from "@/lib/services/ens-service";

type StrategySummary = {
  id: string;
  name: string;
  strategy_kind: "public" | "secret_sauce";
  source_type: string;
  status: string;
  manifest_body: Record<string, unknown>;
  manifest_pointer: string;
  created_at: string;
  updated_at: string;
};

type StrategyListResponse = {
  strategies: StrategySummary[];
  activeStrategyId: string | null;
  activeSecretStrategyId?: string | null;
  activeStrategyIds?: {
    public: string | null;
    secret_sauce: string | null;
  };
};

type CreateStrategyResponse = {
  strategy: StrategySummary;
  strategies: StrategySummary[];
  activeStrategyId: string | null;
  activeSecretStrategyId?: string | null;
  activeStrategyIds?: {
    public: string | null;
    secret_sauce: string | null;
  };
  note: string;
  publicPointerDeferred: boolean;
};

const DEFAULT_MANIFEST = {
  version: 1,
  mode: "momentum",
  thesis: "Prefer liquid Base names, size conservatively, and cut weak trades quickly.",
  objectives: [
    "Upload a public strategy manifest to 0G testnet.",
    "Keep the strategy readable and attributable.",
  ],
  risk: {
    maxPositionSizePct: 15,
    maxDrawdownPct: 8,
  },
  execution: {
    tradeTempo: "measured",
    preferredVenue: "uniswap_base",
  },
};

const DEFAULT_JSON = JSON.stringify(DEFAULT_MANIFEST, null, 2);

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function AgentStrategyStudio() {
  const { ready, authenticated, getAccessToken, login } = usePrivy();
  const { smartAccountAddress, setupStatus } = useAuthState();
  const { ensStatus, loading: ensLoading } = useUserEnsStatus(authenticated);
  const { client: smartWalletClient } = useSmartWallets();

  const [strategies, setStrategies] = useState<StrategySummary[]>([]);
  const [activeStrategyIds, setActiveStrategyIds] = useState<{
    public: string | null;
    secret_sauce: string | null;
  }>({
    public: null,
    secret_sauce: null,
  });
  const [selectedStrategyId, setSelectedStrategyId] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [name, setName] = useState("0G Test Strategy");
  const [strategyKind, setStrategyKind] = useState<"public" | "secret_sauce">("public");
  const [sourceType, setSourceType] = useState("agent_generated_plan");
  const [manifestJson, setManifestJson] = useState(DEFAULT_JSON);
  const [createState, setCreateState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [publishState, setPublishState] = useState<"idle" | "signing" | "confirming" | "confirmed" | "failed">("idle");
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publicManifest, setPublicManifest] = useState<Record<string, unknown> | null>(null);

  const selectedStrategy = useMemo(
    () => strategies.find((strategy) => strategy.id === selectedStrategyId) ?? null,
    [selectedStrategyId, strategies],
  );

  const agentEnsName = ensStatus?.agentEnsName ?? ensStatus?.expectedAgentEnsName ?? null;
  const smartWalletClientAddress =
    (smartWalletClient as { account?: { address?: string } } | undefined)?.account?.address ??
    null;
  const hasMatchingSmartWalletClient =
    smartAccountAddress !== null &&
    smartWalletClientAddress !== null &&
    smartWalletClientAddress.toLowerCase() === smartAccountAddress.toLowerCase();
  const canPublish = Boolean(
    selectedStrategy?.manifest_pointer &&
      smartAccountAddress &&
      ensStatus?.agentEnsName &&
      smartWalletClient &&
      hasMatchingSmartWalletClient,
  );

  const loadStrategies = useCallback(async () => {
    if (!authenticated) return;

    const accessToken = await getAccessToken();
    if (!accessToken) return;

    setListLoading(true);
    try {
      const response = await fetch("/api/agents/strategy?mode=mine", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const data = (await response.json()) as StrategyListResponse | { error?: string };
      if (!response.ok) {
        throw new Error("error" in data && data.error ? data.error : "Failed to load strategies.");
      }

      const payload = data as StrategyListResponse;
      setStrategies(payload.strategies);
      setActiveStrategyIds(
        payload.activeStrategyIds ?? {
          public: payload.activeStrategyId ?? null,
          secret_sauce: payload.activeSecretStrategyId ?? null,
        },
      );
      setSelectedStrategyId(
        (current) =>
          current ??
          payload.activeStrategyIds?.public ??
          payload.activeStrategyIds?.secret_sauce ??
          payload.activeStrategyId ??
          payload.activeSecretStrategyId ??
          payload.strategies[0]?.id ??
          null,
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load strategies.");
    } finally {
      setListLoading(false);
    }
  }, [authenticated, getAccessToken]);

  useEffect(() => {
    void loadStrategies();
  }, [loadStrategies]);

  const handleCreate = useCallback(async () => {
    if (!authenticated) {
      await login();
      return;
    }

    setCreateState("saving");
    setError(null);
    setInfo(null);

    let manifestBody: Record<string, unknown>;
    try {
      const parsed = JSON.parse(manifestJson) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Manifest JSON must be an object.");
      }
      manifestBody = parsed as Record<string, unknown>;
    } catch (parseError) {
      setCreateState("failed");
      setError(parseError instanceof Error ? parseError.message : "Invalid manifest JSON.");
      return;
    }

    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        throw new Error("Sign in before uploading a strategy.");
      }

      const response = await fetch("/api/agents/strategy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          name,
          strategyKind,
          sourceType,
          manifestBody,
          activate: true,
        }),
      });

      const data = (await response.json()) as CreateStrategyResponse | { error?: string };
      if (!response.ok) {
        throw new Error("error" in data && data.error ? data.error : "Failed to upload strategy.");
      }

      const payload = data as CreateStrategyResponse;
      setStrategies(payload.strategies);
      setActiveStrategyIds(
        payload.activeStrategyIds ?? {
          public: payload.activeStrategyId ?? null,
          secret_sauce: payload.activeSecretStrategyId ?? null,
        },
      );
      setSelectedStrategyId(payload.strategy.id);
      setCreateState("saved");
      setInfo(payload.note);
      setPublicManifest(null);
    } catch (createError) {
      setCreateState("failed");
      setError(createError instanceof Error ? createError.message : "Failed to upload strategy.");
    }
  }, [authenticated, getAccessToken, login, manifestJson, name, sourceType, strategyKind]);

  const handlePublish = useCallback(async () => {
    if (!selectedStrategy?.manifest_pointer || !smartAccountAddress || !ensStatus?.agentEnsName) {
      setPublishState("failed");
      setError("Agent ENS identity and a selected strategy pointer are required before publishing.");
      return;
    }

    setPublishState("signing");
    setError(null);
    setInfo(null);
    setPublicManifest(null);

    try {
      const label = extractEnsLabel(ensStatus.agentEnsName);
      const node = await getNameNode(label);
      const recordKey =
        selectedStrategy.strategy_kind === "secret_sauce"
          ? "moonjoy:secret_sauce"
          : "moonjoy:strategy";
      const callData = encodeFunctionData({
        abi: durinRegistryAbi,
        functionName: "setText",
        args: [node, recordKey, selectedStrategy.manifest_pointer],
      });

      if (!smartWalletClient) {
        throw new Error("Smart wallet client is not ready yet.");
      }
      if (!hasMatchingSmartWalletClient) {
        throw new Error(
          `Privy smart wallet client is not bound to ${smartAccountAddress}. Current client address: ${smartWalletClientAddress ?? "none"}.`,
        );
      }

      await smartWalletClient.sendTransaction(
        {
          chain: baseSepolia,
          to: DURIN_L2_REGISTRY_ADDRESS as Address,
          data: callData,
        },
        {
          uiOptions: {
            description: `Write ${recordKey} on your agent ENS name.`,
            buttonText: "Publish to ENS",
          },
        },
      );

      setPublishState("confirming");

      if (selectedStrategy.strategy_kind === "secret_sauce") {
        setPublishState("confirmed");
        setInfo(`Encrypted secret sauce pointer published to ${recordKey}.`);
        return;
      }

      const publicUrl = `/api/agents/strategy?ens=${encodeURIComponent(ensStatus.agentEnsName)}`;
      let resolvedManifest: Record<string, unknown> | null = null;

      for (let attempt = 0; attempt < 8; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
        const response = await fetch(publicUrl);
        if (!response.ok) {
          continue;
        }
        const payload = (await response.json()) as { manifest?: Record<string, unknown> };
        if (payload.manifest) {
          resolvedManifest = payload.manifest;
          break;
        }
      }

      if (!resolvedManifest) {
        throw new Error("ENS transaction sent, but the public strategy route has not resolved yet.");
      }

      setPublishState("confirmed");
      setPublicManifest(resolvedManifest);
      setInfo(`Public route resolved for ${ensStatus.agentEnsName}.`);
    } catch (publishError) {
      setPublishState("failed");
      setError(publishError instanceof Error ? publishError.message : "Failed to publish pointer on ENS.");
    }
  }, [
    ensStatus?.agentEnsName,
    hasMatchingSmartWalletClient,
    selectedStrategy?.manifest_pointer,
    smartAccountAddress,
    smartWalletClient,
    smartWalletClientAddress,
  ]);

  return (
    <main className="min-h-[100dvh] bg-surface px-4 py-8">
      <section className="mx-auto max-w-6xl">
        <div className="neo-panel overflow-hidden">
          <div className="border-b-2 border-black bg-[linear-gradient(135deg,#fff_0%,#f3f6ff_52%,#ffe5da_100%)] px-6 py-6">
            <p className="font-label text-[10px] font-bold uppercase tracking-[0.24em] text-artemis-blue">
              Agent Ops
            </p>
            <h1 className="mt-2 font-display text-4xl font-black uppercase tracking-tight text-black sm:text-5xl">
              Strategy Uplink
            </h1>
            <p className="mt-3 max-w-3xl font-body text-sm leading-6 text-gray-600">
              Upload either a public or secret-sauce strategy manifest to 0G testnet, save the returned pointer, then publish
              that pointer to the matching ENS text record from the browser smart wallet.
            </p>
          </div>

          <div className="grid gap-6 px-6 py-6 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <StatusTile
                  label="Wallet"
                  value={smartAccountAddress ? "Smart Wallet Ready" : setupStatus}
                  detail={smartAccountAddress ?? "Complete Privy onboarding first."}
                />
                <StatusTile
                  label="Agent ENS"
                  value={agentEnsName ?? "Missing"}
                  detail={ensLoading ? "Resolving onchain identity..." : (ensStatus?.agentRegistrationState ?? "blocked")}
                />
                <StatusTile
                  label="Privy Client"
                  value={hasMatchingSmartWalletClient ? "Bound" : "Unbound"}
                  detail={smartWalletClientAddress ?? "Smart wallet client has not initialized yet."}
                />
              </div>

              <div className="rounded-2xl border-3 border-black bg-white p-5 shadow-[6px_6px_0_0_var(--artemis-blue)]">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-display text-lg font-black uppercase tracking-tight text-black">
                      Upload Strategy
                    </p>
                    <p className="mt-1 font-body text-xs text-gray-500">
                      Public strategies stay readable from ENS + 0G. Secret sauce strategies are encrypted before upload and only decrypt through Moonjoy MCP.
                    </p>
                  </div>
                  <span className="rounded-full border-2 border-black bg-gray-50 px-3 py-1 font-label text-[10px] font-bold uppercase tracking-[0.18em] text-artemis-charcoal">
                    Testnet Only
                  </span>
                </div>

                <div className="mt-5 grid gap-4 sm:grid-cols-3">
                  <label className="space-y-2">
                    <span className="font-label text-[10px] font-bold uppercase tracking-[0.2em] text-artemis-charcoal">
                      Strategy Name
                    </span>
                    <input
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      className="w-full rounded-xl border-3 border-black bg-white px-4 py-3 font-body text-sm text-black focus:border-artemis-blue focus:outline-none"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="font-label text-[10px] font-bold uppercase tracking-[0.2em] text-artemis-charcoal">
                      Strategy Kind
                    </span>
                    <select
                      value={strategyKind}
                      onChange={(event) => setStrategyKind(event.target.value as "public" | "secret_sauce")}
                      className="w-full rounded-xl border-3 border-black bg-white px-4 py-3 font-body text-sm text-black focus:border-artemis-blue focus:outline-none"
                    >
                      <option value="public">public</option>
                      <option value="secret_sauce">secret_sauce</option>
                    </select>
                  </label>
                  <label className="space-y-2">
                    <span className="font-label text-[10px] font-bold uppercase tracking-[0.2em] text-artemis-charcoal">
                      Source Type
                    </span>
                    <select
                      value={sourceType}
                      onChange={(event) => setSourceType(event.target.value)}
                      className="w-full rounded-xl border-3 border-black bg-white px-4 py-3 font-body text-sm text-black focus:border-artemis-blue focus:outline-none"
                    >
                      <option value="agent_generated_plan">agent_generated_plan</option>
                      <option value="default_behavior">default_behavior</option>
                      <option value="user_prompt">user_prompt</option>
                      <option value="md_context">md_context</option>
                      <option value="keeperhub_workflow">keeperhub_workflow</option>
                    </select>
                  </label>
                </div>

                <label className="mt-4 block space-y-2">
                  <span className="font-label text-[10px] font-bold uppercase tracking-[0.2em] text-artemis-charcoal">
                    Manifest JSON
                  </span>
                  <textarea
                    value={manifestJson}
                    onChange={(event) => setManifestJson(event.target.value)}
                    rows={16}
                    className="min-h-[320px] w-full rounded-2xl border-3 border-black bg-[#f8fbff] px-4 py-4 font-mono text-[12px] leading-6 text-black focus:border-artemis-blue focus:outline-none"
                    spellCheck={false}
                  />
                </label>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void handleCreate()}
                    disabled={!ready || createState === "saving"}
                    className="neo-btn px-5 py-3 font-display text-xs font-extrabold uppercase tracking-[0.18em] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {createState === "saving" ? "Uploading..." : "Upload To 0G"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setManifestJson(DEFAULT_JSON)}
                    className="neo-btn-secondary px-5 py-3 font-display text-xs font-extrabold uppercase tracking-[0.18em]"
                  >
                    Reset Manifest
                  </button>
                  {info ? <StatusText tone="info" text={info} /> : null}
                  {error ? <StatusText tone="error" text={error} /> : null}
                </div>
              </div>
            </div>

            <div className="space-y-5">
              <div className="rounded-2xl border-3 border-black bg-white p-5 shadow-[6px_6px_0_0_var(--artemis-red)]">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="font-display text-lg font-black uppercase tracking-tight text-black">
                      Current Strategies
                    </p>
                    <p className="mt-1 font-body text-xs text-gray-500">
                      Pick the pointer you want to publish from the browser wallet.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void loadStrategies()}
                    className="neo-btn-secondary px-3 py-2 font-display text-[10px] font-extrabold uppercase tracking-[0.18em]"
                  >
                    Refresh
                  </button>
                </div>

                <div className="mt-4 space-y-3">
                  {listLoading ? (
                    <p className="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-artemis-silver">
                      Loading strategies...
                    </p>
                  ) : strategies.length === 0 ? (
                    <p className="font-body text-sm text-gray-500">
                      No strategies yet. Upload one on the left.
                    </p>
                  ) : (
                    strategies.map((strategy) => {
                      const isSelected = strategy.id === selectedStrategyId;
                      const isActive = strategy.id === activeStrategyIds[strategy.strategy_kind];
                      return (
                        <button
                          type="button"
                          key={strategy.id}
                          onClick={() => setSelectedStrategyId(strategy.id)}
                          className={`w-full rounded-2xl border-3 px-4 py-4 text-left transition ${
                            isSelected
                              ? "border-artemis-blue bg-[#eef4ff] shadow-[4px_4px_0_0_var(--artemis-blue)]"
                              : "border-black bg-white shadow-[4px_4px_0_0_var(--artemis-red)]"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-display text-sm font-black uppercase tracking-tight text-black">
                                {strategy.name}
                              </p>
                              <p className="mt-1 font-label text-[10px] font-bold uppercase tracking-[0.18em] text-artemis-silver">
                                {strategy.strategy_kind} · {strategy.source_type}
                              </p>
                            </div>
                            <span className="rounded-full border-2 border-black bg-white px-2 py-1 font-label text-[9px] font-bold uppercase tracking-[0.18em] text-artemis-charcoal">
                              {isActive ? "Active" : strategy.status}
                            </span>
                          </div>
                          <p className="mt-3 break-all rounded-xl bg-black px-3 py-2 font-mono text-[11px] leading-5 text-white">
                            {strategy.manifest_pointer}
                          </p>
                          <p className="mt-3 font-body text-[11px] text-gray-500">
                            Updated {formatTimestamp(strategy.updated_at)}
                          </p>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="rounded-2xl border-3 border-black bg-white p-5 shadow-[6px_6px_0_0_var(--artemis-blue)]">
                <p className="font-display text-lg font-black uppercase tracking-tight text-black">
                  Publish Pointer
                </p>
                <p className="mt-1 font-body text-xs text-gray-500">
                  Public strategies write to <code className="rounded bg-gray-100 px-1 font-mono text-[10px]">moonjoy:strategy</code>. Secret sauce writes to <code className="rounded bg-gray-100 px-1 font-mono text-[10px]">moonjoy:secret_sauce</code>.
                </p>

                <div className="mt-4 space-y-3">
                  <StatusTile
                    label="Selected Pointer"
                    value={selectedStrategy?.manifest_pointer ?? "Select a strategy"}
                    detail={selectedStrategy?.name ?? "Choose a strategy from the list above."}
                  />
                  <StatusTile
                    label="Publish Target"
                    value={ensStatus?.agentEnsName ?? "Agent ENS not ready"}
                    detail={
                      selectedStrategy?.strategy_kind === "secret_sauce"
                        ? "Writes moonjoy:secret_sauce on Base Sepolia."
                        : "Writes moonjoy:strategy on Base Sepolia."
                    }
                  />
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void handlePublish()}
                    disabled={!canPublish || publishState === "signing" || publishState === "confirming"}
                    className="neo-btn px-5 py-3 font-display text-xs font-extrabold uppercase tracking-[0.18em] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {publishState === "signing"
                      ? "Awaiting Wallet..."
                      : publishState === "confirming"
                        ? "Confirming..."
                        : "Publish To ENS"}
                  </button>
                  {publishState === "confirmed" ? (
                    <StatusText
                      tone="success"
                      text={
                        selectedStrategy?.strategy_kind === "secret_sauce"
                          ? "Encrypted secret sauce pointer published."
                          : "ENS pointer published and the public route resolved."
                      }
                    />
                  ) : null}
                </div>

                {publicManifest ? (
                  <div className="mt-4 rounded-2xl border-3 border-black bg-[#f8fbff] p-4">
                    <p className="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-artemis-charcoal">
                      Public Route Response
                    </p>
                    <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-6 text-black">
                      {JSON.stringify(publicManifest, null, 2)}
                    </pre>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function StatusTile({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-2xl border-3 border-black bg-white px-4 py-4 shadow-[4px_4px_0_0_var(--artemis-blue)]">
      <p className="font-label text-[10px] font-bold uppercase tracking-[0.18em] text-artemis-silver">
        {label}
      </p>
      <p className="mt-2 break-all font-display text-sm font-black uppercase tracking-tight text-black">
        {value}
      </p>
      <p className="mt-1 font-body text-xs text-gray-500">{detail}</p>
    </div>
  );
}

function StatusText({
  tone,
  text,
}: {
  tone: "info" | "success" | "error";
  text: string;
}) {
  const className =
    tone === "success"
      ? "text-green-700"
      : tone === "error"
        ? "text-artemis-red"
        : "text-artemis-blue";

  return (
    <p className={`font-label text-[10px] font-bold uppercase tracking-[0.18em] ${className}`}>
      {text}
    </p>
  );
}
