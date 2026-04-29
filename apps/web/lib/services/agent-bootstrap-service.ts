import { encodeFunctionData, type Address } from "viem";
import { baseSepolia } from "viem/chains";
import {
  durinRegistrarAbi,
  durinRegistryAbi,
  DURIN_L2_REGISTRAR_ADDRESS,
  DURIN_L2_REGISTRY_ADDRESS,
} from "@moonjoy/contracts";
import { getPrivyServerClient } from "@/lib/auth/privy-server";
import {
  loadExecutionAuthorization,
} from "@/lib/services/agent-execution-service";
import { recordMcpEvent } from "@/lib/services/mcp-event-service";
import {
  buildStrategyPointer,
  deriveAgentLabel,
} from "@/lib/services/agent-bootstrap-utils";
import {
  getEnsPublicClient,
  getFullNameForAddress,
  getNameOwner,
  invalidateAddressCaches,
  invalidateLabelCaches,
  resolveAddress,
  resolveTextRecord,
} from "@/lib/services/ens-service";
import { resolveUser } from "@/lib/services/ens-resolution-service";
import { createAdminClient } from "@/lib/supabase/admin";
import { extractEnsLabel } from "@/lib/types/ens";
import {
  STRATEGY_SOURCE_TYPES,
  type StrategyDecisionRecord,
  type StrategyRecord,
  type StrategySourceType,
  type StrategyStatus,
} from "@/lib/types/strategy";
import type { McpRuntimeContext } from "@/lib/types/mcp";

const STRATEGY_SOURCE_TYPE_SET = new Set<string>(STRATEGY_SOURCE_TYPES);

export class AgentBootstrapError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
  }
}

export type AgentBootstrapState = {
  userEnsName: string | null;
  embeddedSignerAddress: string | null;
  agentEnsName: string | null;
  derivedAgentEnsName: string | null;
  derivedAgentLabel: string | null;
  derivedAgentStatus:
    | "ready"
    | "claimable"
    | "claimed_by_other"
    | "owned_by_embedded_signer"
    | "invalid"
    | "missing_user_name";
  derivedAgentStatusReason: string | null;
  agentResolvesToSmartAccount: boolean;
  agentOwnerAddress: string | null;
  agentOwnedBySmartAccount: boolean;
  executionReady: boolean;
  executionSignerId: string | null;
  executionKeyExpiresAt: string | null;
  activeStrategy: StrategyRecord | null;
  strategies: StrategyRecord[];
  publishedStrategyPointer: string | null;
  strategyPointerMatches: boolean;
  requiredTextRecords: Array<{
    key: string;
    expectedValue: string;
    actualValue: string | null;
    synced: boolean;
  }>;
  pendingTransactions: BootstrapPendingTransaction[];
};

type BootstrapTransactionAction =
  | "register_agent"
  | "set_text";

type BootstrapPendingTransaction = {
  action: BootstrapTransactionAction;
  txHash: string | null;
  userOperationHash: string | null;
  transactionId: string | null;
  submittedAt: string;
};

type SentAgentTransaction = BootstrapPendingTransaction & {
  status: "confirmed" | "pending";
};

type StrategyMutationInput = {
  name: string;
  sourceType: StrategySourceType;
  manifestBody: Record<string, unknown>;
  activate?: boolean;
  publishPublicPointer?: boolean;
};

type StrategyUpdateInput = {
  strategyId: string;
  name?: string;
  sourceType?: StrategySourceType;
  manifestBody?: Record<string, unknown>;
  status?: StrategyStatus;
  publishPublicPointer?: boolean;
};

export type BootstrapRecommendation =
  | {
      status: "ready";
      step: "none";
      toolName: null;
      args: {};
      reason: string;
      canRunAutomatically: false;
    }
  | {
      status: "pending";
      step: "claim_agent_identity";
      toolName: null;
      args: {};
      reason: string;
      canRunAutomatically: false;
      pendingTransactions: BootstrapPendingTransaction[];
    }
  | {
      status: "blocked";
      step: "claim_agent_identity";
      toolName: "moonjoy_claim_agent_identity";
      args: {};
      reason: string;
      canRunAutomatically: false;
    }
  | {
      status: "actionable";
      step: "claim_agent_identity";
      toolName: "moonjoy_claim_agent_identity";
      args: {};
      reason: string;
      canRunAutomatically: true;
    }
  | {
      status: "actionable";
      step: "create_default_strategy";
      toolName: "moonjoy_create_strategy";
      args: StrategyMutationInput;
      reason: string;
      canRunAutomatically: true;
    }
  | {
      status: "actionable";
      step: "sync_strategy_pointer";
      toolName: "moonjoy_update_strategy";
      args: StrategyUpdateInput;
      reason: string;
      canRunAutomatically: true;
    };

export async function getAgentBootstrapState(
  context: McpRuntimeContext,
): Promise<AgentBootstrapState> {
  const supabase = createAdminClient();
  const [{ data: user }, { data: strategies }] = await Promise.all([
    supabase
      .from("users")
      .select("embedded_signer_address")
      .eq("id", context.userId)
      .single(),
    supabase
      .from("strategies")
      .select("*")
      .eq("agent_id", context.agentId)
      .order("created_at", { ascending: false }),
  ]);

  const resolvedUser = await resolveUser(context.userId);
  const userEnsName = resolvedUser.ensName;
  const derivedAgent = userEnsName
    ? deriveAgentLabel(extractEnsLabel(userEnsName))
    : null;

  // Fan out independent onchain reads in parallel. The cached ens-service
  // functions keep repeat calls cheap; parallelizing first-time reads still
  // cuts total latency from the sum to the max of all reads.
  const [agentEnsName, derivedAddress, derivedOwnerAddress] = await Promise.all([
    safeGetFullNameForAddress(context.smartAccountAddress as Address),
    derivedAgent?.ok === true
      ? safeResolveAddress(derivedAgent.label)
      : Promise.resolve(null),
    derivedAgent?.ok === true
      ? safeGetNameOwner(derivedAgent.label)
      : Promise.resolve(null),
  ]);

  const strategyRows = ((strategies ?? []) as StrategyRecord[]).map((strategy) => ({
    ...strategy,
    manifest_body: toManifestRecord(strategy.manifest_body),
  }));
  const activeStrategy =
    strategyRows.find((strategy) => strategy.status === "active") ?? null;

  const expectedTextRecords = buildExpectedAgentTextRecords({ userEnsName });

  const activeAgentLabel =
    derivedAgent?.ok &&
    derivedAddress &&
    derivedAddress.toLowerCase() === context.smartAccountAddress.toLowerCase()
      ? derivedAgent.label
      : agentEnsName && agentEnsName.endsWith(".moonjoy.eth")
        ? extractEnsLabel(agentEnsName)
        : null;
  const textRecordReads =
    activeAgentLabel && expectedTextRecords.length > 0
      ? await Promise.all(
          expectedTextRecords.map(async ({ key, expectedValue }) => {
            const actualValue = await safeResolveTextRecord(activeAgentLabel, key);
            return {
              key,
              expectedValue,
              actualValue,
              synced: actualValue === expectedValue,
            };
          }),
        )
      : [];

  const executionReady =
    Boolean(context.executionSignerId) &&
    Boolean(context.executionKeyExpiresAt) &&
    new Date(context.executionKeyExpiresAt ?? 0).getTime() > Date.now();

  const publishedStrategyPointer =
    textRecordReads.find((record) => record.key === "moonjoy:strategy")
      ?.actualValue ?? null;
  const pendingTransactions = await getPendingBootstrapTransactions(context, {
    derivedAddress,
    agentOwnerAddress: derivedOwnerAddress,
    requiredTextRecords: textRecordReads,
  });

  return {
    userEnsName,
    embeddedSignerAddress: user?.embedded_signer_address ?? null,
    agentEnsName:
      agentEnsName ??
      (derivedAgent?.ok &&
      derivedAddress &&
      derivedAddress.toLowerCase() === context.smartAccountAddress.toLowerCase()
        ? derivedAgent.ensName
        : null),
    derivedAgentEnsName: derivedAgent?.ok ? derivedAgent.ensName : null,
    derivedAgentLabel: derivedAgent?.ok ? derivedAgent.label : null,
    derivedAgentStatus: getDerivedAgentStatus({
      userEnsName,
      derivedAgent,
      derivedAddress,
      derivedOwnerAddress,
      embeddedSignerAddress: user?.embedded_signer_address ?? null,
      smartAccountAddress: context.smartAccountAddress,
    }),
    derivedAgentStatusReason: getDerivedAgentStatusReason({
      userEnsName,
      derivedAgent,
      derivedAddress,
      derivedOwnerAddress,
      embeddedSignerAddress: user?.embedded_signer_address ?? null,
      smartAccountAddress: context.smartAccountAddress,
    }),
    agentResolvesToSmartAccount:
      Boolean(derivedAddress) &&
      derivedAddress?.toLowerCase() === context.smartAccountAddress.toLowerCase(),
    agentOwnerAddress: derivedOwnerAddress,
    agentOwnedBySmartAccount:
      Boolean(derivedOwnerAddress) &&
      derivedOwnerAddress?.toLowerCase() ===
        context.smartAccountAddress.toLowerCase(),
    executionReady,
    executionSignerId: context.executionSignerId,
    executionKeyExpiresAt: context.executionKeyExpiresAt,
    activeStrategy,
    strategies: strategyRows,
    publishedStrategyPointer,
    strategyPointerMatches: true,
    requiredTextRecords: textRecordReads,
    pendingTransactions,
  };
}

export async function claimAgentIdentity(
  context: McpRuntimeContext,
): Promise<Record<string, unknown>> {
  const state = await getAgentBootstrapState(context);
  const execution = await requireExecutionAuthorization(context);

  if (!state.userEnsName) {
    throw new AgentBootstrapError(
      "User ENS identity must exist before the agent can claim its derived name.",
      409,
    );
  }

  if (!state.derivedAgentLabel || !state.derivedAgentEnsName) {
    throw new AgentBootstrapError(
      state.derivedAgentStatusReason ??
        "Could not derive the agent ENS name from the user ENS name.",
      409,
    );
  }

  if (
    state.derivedAgentStatus === "claimed_by_other"
      && state.embeddedSignerAddress?.toLowerCase() !==
        (await safeResolveAddress(state.derivedAgentLabel))?.toLowerCase()
  ) {
    throw new AgentBootstrapError(
      "Derived agent ENS name is already claimed by a different address.",
      409,
    );
  }

  if (state.pendingTransactions.length > 0) {
    return {
      status: "pending",
      agentEnsName: state.derivedAgentEnsName,
      smartAccountAddress: context.smartAccountAddress,
      pendingTransactions: state.pendingTransactions,
      requiredTextRecords: state.requiredTextRecords,
      identityReady:
        state.derivedAgentStatus === "ready" &&
        state.agentResolvesToSmartAccount &&
        state.agentOwnedBySmartAccount,
    };
  }

  const transactions: SentAgentTransaction[] = [];
  const currentDerivedAddress = await safeResolveAddress(state.derivedAgentLabel);

  if (!currentDerivedAddress) {
    const userLabel = extractEnsLabel(state.userEnsName);
    transactions.push(
      await sendAgentTransaction({
        context,
        action: "register_agent",
        executionWalletId: execution.executionWalletId,
        authorizationContext: execution.authorizationContext,
        fromAddress: context.smartAccountAddress,
        to: DURIN_L2_REGISTRAR_ADDRESS,
        data: encodeFunctionData({
          abi: durinRegistrarAbi,
          functionName: "registerAgent",
          args: [userLabel, context.smartAccountAddress as Address],
        }),
      }),
    );
  }

  // After a confirmed write, stale cached ENS reads must be refreshed so the
  // agent sees its new identity on the very next tool call.
  if (transactions.some((tx) => tx.status === "confirmed")) {
    invalidateLabelCaches(state.derivedAgentLabel);
    invalidateAddressCaches(context.smartAccountAddress as Address);
  }

  if (transactions.some((tx) => tx.status === "pending")) {
    return buildPendingClaimResult(
      context,
      state.derivedAgentEnsName,
      transactions,
      await getAgentBootstrapState(context),
    );
  }

  await ensureAddressResolution(state.derivedAgentLabel, context.smartAccountAddress);

  const finalState = await getAgentBootstrapState(context);
  return {
    status: "ok",
    agentEnsName: finalState.derivedAgentEnsName,
    smartAccountAddress: context.smartAccountAddress,
    txHashes: transactions.flatMap((tx) => (tx.txHash ? [tx.txHash] : [])),
    userOperationHashes: transactions.flatMap((tx) =>
      tx.userOperationHash ? [tx.userOperationHash] : [],
    ),
    requiredTextRecords: finalState.requiredTextRecords,
    identityReady:
      finalState.derivedAgentStatus === "ready" &&
      finalState.agentResolvesToSmartAccount &&
      finalState.agentOwnedBySmartAccount,
  };
}

export async function listStrategies(
  context: McpRuntimeContext,
  includeArchived = false,
): Promise<Record<string, unknown>> {
  const state = await getAgentBootstrapState(context);
  return {
    strategies: includeArchived
      ? state.strategies
      : state.strategies.filter((strategy) => strategy.status !== "archived"),
    activeStrategyId: state.activeStrategy?.id ?? null,
  };
}

export async function createStrategy(
  context: McpRuntimeContext,
  input: StrategyMutationInput,
): Promise<Record<string, unknown>> {
  const supabase = createAdminClient();
  const manifestBody = normalizeManifestBody(input.manifestBody);
  const pointer = buildStrategyPointer(manifestBody);
  const name = normalizeStrategyName(input.name);
  const sourceType = normalizeStrategySourceType(input.sourceType);
  const state = await getAgentBootstrapState(context);

  const shouldActivate = input.activate ?? (state.activeStrategy === null);

  const { data, error } = await supabase
    .from("strategies")
    .insert({
      user_id: context.userId,
      agent_id: context.agentId,
      agent_smart_account_address: context.smartAccountAddress,
      name,
      source_type: sourceType,
      manifest_body: manifestBody,
      manifest_pointer: pointer,
      local_revision: 1,
      status: "draft",
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new AgentBootstrapError("Failed to create strategy.", 500);
  }

  const created = {
    ...(data as StrategyRecord),
    manifest_body: toManifestRecord((data as StrategyRecord).manifest_body),
  };

  const activated = shouldActivate
    ? await activateStrategyForAgent(
        supabase,
        context.agentId,
        created.id,
        state.activeStrategy?.id ?? null,
      )
    : created;

  if (shouldActivate && input.publishPublicPointer !== false) {
    await maybeSyncAgentPublicRecords(context);
  }

  return {
    status: "ok",
    strategy: activated,
  };
}

export async function updateStrategy(
  context: McpRuntimeContext,
  input: StrategyUpdateInput,
): Promise<Record<string, unknown>> {
  const supabase = createAdminClient();
  const existing = await requireOwnedStrategy(context, input.strategyId);

  const nextName = input.name ? normalizeStrategyName(input.name) : existing.name;
  const nextSourceType = input.sourceType
    ? normalizeStrategySourceType(input.sourceType)
    : existing.source_type;
  const nextManifestBody = input.manifestBody
    ? normalizeManifestBody(input.manifestBody)
    : existing.manifest_body;
  const nextManifestPointer = buildStrategyPointer(nextManifestBody);
  const nextStatus = input.status ?? existing.status;
  const { data: activeStrategy } = await supabase
    .from("strategies")
    .select("id")
    .eq("agent_id", context.agentId)
    .eq("status", "active")
    .maybeSingle();

  const manifestChanged =
    JSON.stringify(nextManifestBody) !== JSON.stringify(existing.manifest_body);
  const revisionChanged =
    manifestChanged ||
    nextName !== existing.name ||
    nextSourceType !== existing.source_type ||
    nextStatus !== existing.status;

  const { data, error } = await supabase
    .from("strategies")
    .update({
      name: nextName,
      source_type: nextSourceType,
      manifest_body: nextManifestBody,
      manifest_pointer: nextManifestPointer,
      local_revision: revisionChanged
        ? existing.local_revision + 1
        : existing.local_revision,
      status: nextStatus === "active" ? "draft" : nextStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", existing.id)
    .select("*")
    .single();

  if (error || !data) {
    throw new AgentBootstrapError("Failed to update strategy.", 500);
  }

  const updatedStrategy =
    nextStatus === "active"
      ? await activateStrategyForAgent(
          supabase,
          context.agentId,
          existing.id,
          activeStrategy?.id && activeStrategy.id !== existing.id
            ? activeStrategy.id
            : null,
        )
      : {
          ...(data as StrategyRecord),
          manifest_body: toManifestRecord((data as StrategyRecord).manifest_body),
        };

  if (nextStatus === "active" && input.publishPublicPointer !== false) {
    await maybeSyncAgentPublicRecords(context);
  }

  return {
    status: "ok",
    strategy: updatedStrategy,
  };
}

export async function recordStrategyDecision(
  context: McpRuntimeContext,
  input: {
    strategyId: string;
    rationale: string;
    matchId?: string;
    tradeId?: string;
  },
): Promise<Record<string, unknown>> {
  const supabase = createAdminClient();
  await requireOwnedStrategy(context, input.strategyId);

  const rationale = input.rationale.trim();
  if (!rationale) {
    throw new AgentBootstrapError("Strategy rationale is required.", 400);
  }

  const { data, error } = await supabase
    .from("strategy_decisions")
    .insert({
      strategy_id: input.strategyId,
      match_id: input.matchId ?? null,
      trade_id: input.tradeId ?? null,
      rationale,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new AgentBootstrapError("Failed to record strategy decision.", 500);
  }

  return {
    status: "ok",
    decision: data as StrategyDecisionRecord,
  };
}

export async function getBootstrapRecommendation(
  context: McpRuntimeContext,
): Promise<BootstrapRecommendation> {
  const state = await getAgentBootstrapState(context);
  return buildBootstrapRecommendationFromState(state);
}

export function buildBootstrapRecommendationFromState(
  state: AgentBootstrapState,
): BootstrapRecommendation {
  if (!state.userEnsName) {
    return {
      status: "blocked",
      step: "claim_agent_identity",
      toolName: "moonjoy_claim_agent_identity",
      args: {},
      reason: "User ENS identity is missing, so agent bootstrap cannot proceed.",
      canRunAutomatically: false,
    };
  }

  if (state.pendingTransactions.length > 0) {
    return {
      status: "pending",
      step: "claim_agent_identity",
      toolName: null,
      args: {},
      reason:
        "An account-abstracted identity transaction is still settling. Re-read Moonjoy state after it confirms.",
      canRunAutomatically: false,
      pendingTransactions: state.pendingTransactions,
    };
  }

  if (state.derivedAgentStatus !== "ready") {
    if (!state.executionReady) {
      return {
        status: "blocked",
        step: "claim_agent_identity",
        toolName: "moonjoy_claim_agent_identity",
        args: {},
        reason:
          "Agent ENS identity is still missing, but wallet execution authority is unavailable.",
        canRunAutomatically: false,
      };
    }

    return {
      status: "actionable",
      step: "claim_agent_identity",
      toolName: "moonjoy_claim_agent_identity",
      args: {},
      reason:
        state.derivedAgentStatusReason ??
        "Claim the derived agent ENS identity and sync its public records.",
      canRunAutomatically: true,
    };
  }

  if (!state.agentOwnedBySmartAccount) {
    if (
      state.agentOwnerAddress?.toLowerCase() ===
      state.embeddedSignerAddress?.toLowerCase()
    ) {
      return {
        status: "actionable",
        step: "claim_agent_identity",
        toolName: "moonjoy_claim_agent_identity",
        args: {},
        reason:
          "Agent ENS currently resolves to the smart wallet, but the ENS NFT is still owned by the human EOA.",
        canRunAutomatically: true,
      };
    }

    return {
      status: "blocked",
      step: "claim_agent_identity",
      toolName: "moonjoy_claim_agent_identity",
      args: {},
      reason:
        "Agent ENS currently resolves to the smart wallet, but the ENS NFT is owned by a different address.",
      canRunAutomatically: false,
    };
  }

  if (!state.activeStrategy) {
    return {
      status: "actionable",
      step: "create_default_strategy",
      toolName: "moonjoy_create_strategy",
      args: buildDefaultBootstrapStrategy(state),
      reason: "The agent does not have an active default strategy yet.",
      canRunAutomatically: true,
    };
  }

  return {
    status: "ready",
    step: "none",
    toolName: null,
    args: {},
    reason: "Agent identity and default strategy are already bootstrapped.",
    canRunAutomatically: false,
  };
}

export async function executeBootstrapStep(
  context: McpRuntimeContext,
): Promise<Record<string, unknown>> {
  const recommendation = await getBootstrapRecommendation(context);

  if (recommendation.status === "ready") {
    return {
      status: "ready",
      executedStep: "none",
      recommendation,
    };
  }

  if (recommendation.status === "blocked") {
    return {
      status: "blocked",
      executedStep: "none",
      recommendation,
    };
  }

  if (recommendation.status === "pending") {
    return {
      status: "pending",
      executedStep: "none",
      recommendation,
    };
  }

  if (recommendation.step === "claim_agent_identity") {
    return {
      status: "ok",
      executedStep: recommendation.step,
      recommendation,
      result: await claimAgentIdentity(context),
    };
  }

  if (recommendation.step === "create_default_strategy") {
    return {
      status: "ok",
      executedStep: recommendation.step,
      recommendation,
      result: await createStrategy(context, recommendation.args),
    };
  }

  return {
    status: "ok",
    executedStep: recommendation.step,
    recommendation,
    result: await updateStrategy(context, recommendation.args),
  };
}

export async function runBootstrap(
  context: McpRuntimeContext,
): Promise<Record<string, unknown>> {
  const steps: Array<{
    step: Exclude<BootstrapRecommendation["step"], "none">;
    toolName: string | null;
    result: Record<string, unknown>;
  }> = [];

  for (let index = 0; index < 4; index += 1) {
    const recommendation = await getBootstrapRecommendation(context);

    if (recommendation.status === "ready") {
      return {
        status: "ready",
        steps,
        finalRecommendation: recommendation,
      };
    }

    if (recommendation.status === "blocked") {
      return {
        status: "blocked",
        steps,
        finalRecommendation: recommendation,
      };
    }

    if (recommendation.status === "pending") {
      return {
        status: "pending",
        steps,
        finalRecommendation: recommendation,
      };
    }

    const result =
      recommendation.step === "claim_agent_identity"
        ? await claimAgentIdentity(context)
        : recommendation.step === "create_default_strategy"
          ? await createStrategy(context, recommendation.args)
          : await updateStrategy(context, recommendation.args);

    steps.push({
      step: recommendation.step,
      toolName: recommendation.toolName,
      result,
    });
  }

  return {
    status: "ok",
    steps,
    finalRecommendation: await getBootstrapRecommendation(context),
    loopGuardHit: true,
  };
}

async function syncAgentTextRecords(
  context: McpRuntimeContext,
  state: AgentBootstrapState,
  authorizationContext: {
    executionWalletId: string;
    authorization_private_keys: string[];
  },
): Promise<SentAgentTransaction[]> {
  if (!state.derivedAgentLabel || state.derivedAgentStatus !== "ready") {
    return [];
  }
  if (
    state.agentOwnerAddress?.toLowerCase() !==
      context.smartAccountAddress.toLowerCase()
  ) {
    return [];
  }

  const transactions: SentAgentTransaction[] = [];
  for (const record of buildExpectedAgentTextRecords({
    userEnsName: state.userEnsName,
  })) {
    const currentValue = await safeResolveTextRecord(state.derivedAgentLabel, record.key);
    if (currentValue === record.expectedValue) {
      continue;
    }

    transactions.push(
      await sendAgentTransaction({
        context,
        action: "set_text",
        executionWalletId: authorizationContext.executionWalletId,
        authorizationContext,
        fromAddress: context.smartAccountAddress,
        to: DURIN_L2_REGISTRY_ADDRESS,
        data: encodeFunctionData({
          abi: durinRegistryAbi,
          functionName: "setText",
          args: [await getNameNode(state.derivedAgentLabel), record.key, record.expectedValue],
        }),
      }),
    );
  }

  if (transactions.some((tx) => tx.status === "confirmed")) {
    invalidateLabelCaches(state.derivedAgentLabel);
  }

  return transactions;
}

async function sendAgentTransaction(params: {
  context: McpRuntimeContext;
  action: BootstrapTransactionAction;
  executionWalletId: string;
  authorizationContext: { authorization_private_keys: string[] };
  fromAddress: string;
  to: string;
  data: `0x${string}`;
}): Promise<SentAgentTransaction> {
  const response = await getPrivyEthereumService().sendTransaction(
    params.executionWalletId,
    {
      caip2: `eip155:${baseSepolia.id}`,
      sponsor: true,
      authorization_context: params.authorizationContext,
      params: {
        transaction: {
          from: params.fromAddress,
          to: params.to,
          data: params.data,
          chain_id: baseSepolia.id,
          type: 2,
        },
      },
    },
  );

  const txHash =
    typeof response.hash === "string" && response.hash.length > 0
      ? (response.hash as `0x${string}`)
      : null;
  const userOperationHash =
    "user_operation_hash" in response &&
    typeof response.user_operation_hash === "string" &&
    response.user_operation_hash.length > 0
      ? response.user_operation_hash
      : null;
  const transactionId =
    "transaction_id" in response &&
    typeof response.transaction_id === "string" &&
    response.transaction_id.length > 0
      ? response.transaction_id
      : null;
  const submittedAt = new Date().toISOString();

  await recordMcpEvent(params.context, "bootstrap.tx_submitted", {
    action: params.action,
    txHash,
    userOperationHash,
    transactionId,
    submittedAt,
  });

  if (txHash) {
    const receipt = await waitForReceiptQuick(txHash);
    if (receipt) {
      await recordMcpEvent(params.context, "bootstrap.tx_confirmed", {
        action: params.action,
        txHash,
        userOperationHash,
        transactionId,
        submittedAt,
        blockNumber: receipt.blockNumber.toString(),
      });

      return {
        action: params.action,
        txHash,
        userOperationHash,
        transactionId,
        submittedAt,
        status: "confirmed",
      };
    }
  }

  return {
    action: params.action,
    txHash,
    userOperationHash,
    transactionId,
    submittedAt,
    status: "pending",
  };
}

async function requireExecutionAuthorization(context: McpRuntimeContext) {
  const execution = await loadExecutionAuthorization(context.approvalId);
  if (!execution) {
    throw new AgentBootstrapError(
      "This MCP approval does not include agent wallet execution authority. Read and strategy tools still work, but claiming agent ENS identity requires wallet execution support.",
      409,
    );
  }

  return execution;
}

async function maybeSyncAgentPublicRecords(
  context: McpRuntimeContext,
): Promise<void> {
  const execution = await loadExecutionAuthorization(context.approvalId);
  if (!execution) {
    return;
  }

  const state = await getAgentBootstrapState(context);
  if (
    state.agentOwnerAddress?.toLowerCase() !==
      context.smartAccountAddress.toLowerCase()
  ) {
    return;
  }
  await syncAgentTextRecords(
    context,
    state,
    {
      executionWalletId: execution.executionWalletId,
      authorization_private_keys:
        execution.authorizationContext.authorization_private_keys,
    },
  );
}

function buildPendingClaimResult(
  context: McpRuntimeContext,
  agentEnsName: string | null,
  transactions: SentAgentTransaction[],
  state: AgentBootstrapState,
): Record<string, unknown> {
  return {
    status: "pending",
    agentEnsName,
    smartAccountAddress: context.smartAccountAddress,
    txHashes: transactions.flatMap((tx) => (tx.txHash ? [tx.txHash] : [])),
    userOperationHashes: transactions.flatMap((tx) =>
      tx.userOperationHash ? [tx.userOperationHash] : [],
    ),
    pendingTransactions: transactions
      .filter((tx) => tx.status === "pending")
      .map(({ action, txHash, userOperationHash, transactionId, submittedAt }) => ({
        action,
        txHash,
        userOperationHash,
        transactionId,
        submittedAt,
      })),
    requiredTextRecords: state.requiredTextRecords,
    identityReady:
      state.derivedAgentStatus === "ready" &&
      state.agentResolvesToSmartAccount &&
      state.agentOwnedBySmartAccount,
  };
}

async function getPendingBootstrapTransactions(
  context: McpRuntimeContext,
  current: {
    derivedAddress: Address | null;
    agentOwnerAddress: Address | null;
    requiredTextRecords: AgentBootstrapState["requiredTextRecords"];
  },
): Promise<BootstrapPendingTransaction[]> {
  const since = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  const { data } = await createAdminClient()
    .from("mcp_events")
    .select("event_type, payload, created_at")
    .eq("approval_id", context.approvalId)
    .in("event_type", ["bootstrap.tx_submitted", "bootstrap.tx_confirmed"])
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(40);

  const confirmedIds = new Set<string>();
  for (const row of data ?? []) {
    if (row.event_type !== "bootstrap.tx_confirmed") continue;
    const payload = toBootstrapEventPayload(row.payload);
    const id = payload.userOperationHash ?? payload.transactionId ?? payload.txHash;
    if (id) confirmedIds.add(id);
  }

  const pending: BootstrapPendingTransaction[] = [];
  for (const row of data ?? []) {
    if (row.event_type !== "bootstrap.tx_submitted") continue;
    const payload = toBootstrapEventPayload(row.payload);
    const id = payload.userOperationHash ?? payload.transactionId ?? payload.txHash;
    if (!id || confirmedIds.has(id)) continue;
    if (isBootstrapTransactionSettled(payload.action, current, context)) continue;
    pending.push({
      action: payload.action,
      txHash: payload.txHash,
      userOperationHash: payload.userOperationHash,
      transactionId: payload.transactionId,
      submittedAt: row.created_at,
    });
  }

  return pending;
}

function isBootstrapTransactionSettled(
  action: BootstrapTransactionAction,
  current: {
    derivedAddress: Address | null;
    agentOwnerAddress: Address | null;
    requiredTextRecords: AgentBootstrapState["requiredTextRecords"];
  },
  context: McpRuntimeContext,
): boolean {
  if (action === "register_agent") {
    return (
      Boolean(current.derivedAddress) &&
      current.derivedAddress?.toLowerCase() ===
        context.smartAccountAddress.toLowerCase()
    );
  }

  return current.requiredTextRecords.every((record) => record.synced);
}

function toBootstrapEventPayload(payload: unknown): {
  action: BootstrapTransactionAction;
  txHash: string | null;
  userOperationHash: string | null;
  transactionId: string | null;
} {
  const input =
    payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  return {
    action: (input.action as BootstrapTransactionAction) ?? "set_text",
    txHash: typeof input.txHash === "string" ? input.txHash : null,
    userOperationHash:
      typeof input.userOperationHash === "string" ? input.userOperationHash : null,
    transactionId:
      typeof input.transactionId === "string" ? input.transactionId : null,
  };
}

async function waitForReceiptQuick(hash: `0x${string}`) {
  try {
    return await getEnsPublicClient().waitForTransactionReceipt({
      hash,
      timeout: 5_000,
    });
  } catch {
    return null;
  }
}

async function requireOwnedStrategy(
  context: McpRuntimeContext,
  strategyId: string,
): Promise<StrategyRecord> {
  const { data } = await createAdminClient()
    .from("strategies")
    .select("*")
    .eq("id", strategyId)
    .eq("user_id", context.userId)
    .eq("agent_id", context.agentId)
    .maybeSingle();

  if (!data) {
    throw new AgentBootstrapError("Strategy not found for this agent.", 404);
  }

  return {
    ...(data as StrategyRecord),
    manifest_body: toManifestRecord((data as StrategyRecord).manifest_body),
  };
}

async function archiveActiveStrategy(
  supabase: ReturnType<typeof createAdminClient>,
  strategyId: string,
) {
  const { error } = await supabase
    .from("strategies")
    .update({
      status: "archived",
      updated_at: new Date().toISOString(),
    })
    .eq("id", strategyId);

  if (error) {
    throw new AgentBootstrapError("Failed to archive the previous active strategy.", 500);
  }
}

async function activateStrategyForAgent(
  supabase: ReturnType<typeof createAdminClient>,
  agentId: string,
  strategyId: string,
  previousActiveStrategyId: string | null,
): Promise<StrategyRecord> {
  if (previousActiveStrategyId && previousActiveStrategyId !== strategyId) {
    await archiveActiveStrategy(supabase, previousActiveStrategyId);
  }

  const { data, error } = await supabase
    .from("strategies")
    .update({
      status: "active",
      updated_at: new Date().toISOString(),
    })
    .eq("id", strategyId)
    .eq("agent_id", agentId)
    .select("*")
    .single();

  if (!error && data) {
    return {
      ...(data as StrategyRecord),
      manifest_body: toManifestRecord((data as StrategyRecord).manifest_body),
    };
  }

  if (previousActiveStrategyId && previousActiveStrategyId !== strategyId) {
    await supabase
      .from("strategies")
      .update({
        status: "active",
        updated_at: new Date().toISOString(),
      })
      .eq("id", previousActiveStrategyId);
  }

  throw new AgentBootstrapError("Failed to activate strategy.", 500);
}

async function ensureAddressResolution(
  label: string,
  expectedAddress: string,
): Promise<void> {
  const resolvedAddress = await safeResolveAddress(label);
  if (
    !resolvedAddress ||
    resolvedAddress.toLowerCase() !== expectedAddress.toLowerCase()
  ) {
    throw new AgentBootstrapError(
      "Agent ENS name does not resolve to the agent smart account after registration.",
      502,
    );
  }
}

function normalizeStrategyName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new AgentBootstrapError("Strategy name is required.", 400);
  }
  return trimmed.slice(0, 80);
}

function normalizeStrategySourceType(sourceType: string): StrategySourceType {
  if (!STRATEGY_SOURCE_TYPE_SET.has(sourceType)) {
    throw new AgentBootstrapError("Invalid strategy source type.", 400);
  }

  return sourceType as StrategySourceType;
}

function normalizeManifestBody(
  manifestBody: Record<string, unknown>,
): Record<string, unknown> {
  if (!manifestBody || Array.isArray(manifestBody)) {
    throw new AgentBootstrapError("Strategy manifest body must be an object.", 400);
  }
  return manifestBody;
}

function toManifestRecord(value: unknown): Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return {};
  }

  return value as Record<string, unknown>;
}

function buildExpectedAgentTextRecords(params: {
  userEnsName: string | null;
}) {
  const records = [{ key: "moonjoy:type", expectedValue: "agent" }];

  if (params.userEnsName) {
    records.push({
      key: "moonjoy:user",
      expectedValue: params.userEnsName,
    });
  }

  return records;
}

function buildDefaultBootstrapStrategy(
  state: AgentBootstrapState,
): StrategyMutationInput {
  const ownerLabel = state.userEnsName
    ? extractEnsLabel(state.userEnsName)
    : "moonjoy";

  return {
    name: `${ownerLabel} Default Strategy`,
    sourceType: "default_behavior",
    activate: true,
    publishPublicPointer: true,
    manifestBody: {
      version: 1,
      mode: "default_behavior",
      thesis:
        "Protect capital first, prefer liquid Base assets, and avoid reactive overtrading.",
      objectives: [
        "Maintain a clear risk budget.",
        "Prefer liquid markets and obvious setups.",
        "De-risk quickly when the edge is weak.",
      ],
      risk: {
        maxPositionSizePct: 25,
        maxSingleAssetExposurePct: 35,
        maxDrawdownPct: 12,
      },
      execution: {
        tradeTempo: "measured",
        preferredVenue: "uniswap_base",
        avoidConditions: ["thin liquidity", "unclear direction"],
      },
    },
  };
}

function getDerivedAgentStatus(params: {
  userEnsName: string | null;
  derivedAgent:
    | ReturnType<typeof deriveAgentLabel>
    | null;
  derivedAddress: Address | null;
  derivedOwnerAddress: Address | null;
  embeddedSignerAddress: string | null;
  smartAccountAddress: string;
}): AgentBootstrapState["derivedAgentStatus"] {
  if (!params.userEnsName) return "missing_user_name";
  if (!params.derivedAgent?.ok) return "invalid";
  if (!params.derivedAddress) return "claimable";
  if (
    params.derivedAddress.toLowerCase() ===
    params.smartAccountAddress.toLowerCase()
  ) {
    if (
      params.derivedOwnerAddress &&
      params.derivedOwnerAddress.toLowerCase() ===
        params.smartAccountAddress.toLowerCase()
    ) {
      return "ready";
    }
    if (
      params.derivedOwnerAddress &&
      params.embeddedSignerAddress &&
      params.derivedOwnerAddress.toLowerCase() ===
        params.embeddedSignerAddress.toLowerCase()
    ) {
      return "owned_by_embedded_signer";
    }
    return "ready";
  }
  return "claimed_by_other";
}

function getDerivedAgentStatusReason(params: {
  userEnsName: string | null;
  derivedAgent:
    | ReturnType<typeof deriveAgentLabel>
    | null;
  derivedAddress: Address | null;
  derivedOwnerAddress: Address | null;
  embeddedSignerAddress: string | null;
  smartAccountAddress: string;
}): string | null {
  if (!params.userEnsName) {
    return "User ENS identity is missing.";
  }

  if (!params.derivedAgent?.ok) {
    return params.derivedAgent?.reason ?? "Could not derive agent ENS label.";
  }

  if (!params.derivedAddress) {
    return "Derived agent ENS name is available to claim.";
  }

  if (
    params.derivedAddress.toLowerCase() !==
    params.smartAccountAddress.toLowerCase()
  ) {
    return "Derived agent ENS name is already claimed by another address.";
  }

  if (
    params.derivedOwnerAddress &&
    params.derivedOwnerAddress.toLowerCase() !==
      params.smartAccountAddress.toLowerCase()
  ) {
    if (
      params.embeddedSignerAddress &&
      params.derivedOwnerAddress.toLowerCase() ===
        params.embeddedSignerAddress.toLowerCase()
    ) {
      return "Derived agent ENS NFT is still owned by the human EOA, not the agent smart wallet.";
    }

    return "Derived agent ENS NFT is owned by a different address.";
  }

  return null;
}

function getPrivyEthereumService() {
  return getPrivyServerClient().wallets().ethereum();
}

async function getNameNode(label: string): Promise<`0x${string}`> {
  const client = getEnsPublicClient();
  const baseNode = (await client.readContract({
    address: DURIN_L2_REGISTRY_ADDRESS,
    abi: durinRegistryAbi,
    functionName: "baseNode",
  })) as `0x${string}`;
  return (await client.readContract({
    address: DURIN_L2_REGISTRY_ADDRESS,
    abi: durinRegistryAbi,
    functionName: "makeNode",
    args: [baseNode, label],
  })) as `0x${string}`;
}

async function safeResolveAddress(label: string): Promise<Address | null> {
  try {
    return await resolveAddress(label);
  } catch {
    return null;
  }
}

async function safeGetNameOwner(label: string): Promise<Address | null> {
  try {
    return await getNameOwner(label);
  } catch {
    return null;
  }
}

async function safeResolveTextRecord(
  label: string,
  key: string,
): Promise<string | null> {
  try {
    const value = await resolveTextRecord(label, key);
    return value || null;
  } catch {
    return null;
  }
}

async function safeGetFullNameForAddress(
  address: Address,
): Promise<string | null> {
  try {
    return await getFullNameForAddress(address);
  } catch {
    return null;
  }
}
