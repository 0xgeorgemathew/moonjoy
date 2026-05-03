import { NextResponse } from "next/server";
import { getAuthenticatedUserId, AuthError } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getFullNameForAddress,
  resolveAddress,
  resolveTextRecord,
} from "@/lib/services/ens-service";
import { deriveAgentLabel } from "@/lib/services/agent-bootstrap-utils";
import { getPublicAgentStats } from "@/lib/services/agent-stats-service";
import { extractEnsLabel } from "@/lib/types/ens";
import type { Address } from "viem";

const MATCH_PREFERENCE_KEY = "moonjoy:match_preference";

export async function GET(request: Request) {
  let privyUserId: string;
  try {
    privyUserId = await getAuthenticatedUserId(request);
  } catch (err) {
    const status = err instanceof AuthError ? err.statusCode : 401;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unauthorized" },
      { status },
    );
  }

  const supabase = createAdminClient();

  const { data: user } = await supabase
    .from("users")
    .select("id, embedded_signer_address")
    .eq("privy_user_id", privyUserId)
    .single();

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const { data: agent } = user
    ? await supabase
        .from("agents")
        .select("id, smart_account_address")
        .eq("user_id", user.id)
        .eq("status", "active")
        .maybeSingle()
    : { data: null };

  const userEnsName = user.embedded_signer_address
    ? await getFullNameForAddress(user.embedded_signer_address as Address)
    : null;
  const expectedAgent =
    userEnsName ? deriveAgentLabel(extractEnsLabel(userEnsName)) : null;
  const expectedAgentEnsName = expectedAgent?.ok ? expectedAgent.ensName : null;
  const agentEnsName =
    agent?.smart_account_address
      ? await getFullNameForAddress(agent.smart_account_address as Address)
      : null;
  const agentResolvesToSmartWallet =
    expectedAgent?.ok && agent?.smart_account_address
      ? (await resolveAddress(expectedAgent.label))?.toLowerCase() ===
        agent.smart_account_address.toLowerCase()
      : false;
  const agentStats = await getPublicAgentStats(agent?.id ?? null, agentEnsName);

  const pendingAgentTransaction =
    agent?.id && expectedAgentEnsName !== agentEnsName
      ? await getPendingAgentBootstrapTransaction(supabase, agent.id)
      : null;

  const { data: activeStrategies } = agent?.id
    ? await supabase
        .from("strategies")
        .select("id, name, strategy_kind, status, manifest_pointer, updated_at")
        .eq("agent_id", agent.id)
        .eq("status", "active")
    : { data: [] as Array<Record<string, unknown>> };

  const textRecords: { record_key: string; record_value: string }[] = [];
  if (userEnsName) {
    const label = extractEnsLabel(userEnsName);
    try {
      const value = await resolveTextRecord(label, MATCH_PREFERENCE_KEY);
      if (value) {
        textRecords.push({
          record_key: MATCH_PREFERENCE_KEY,
          record_value: value,
        });
      }
    } catch {
      // Text records are convenience reads from chain; identity still works.
    }
  }

  return NextResponse.json({
    userEnsName,
    embeddedSignerAddress: user.embedded_signer_address,
    agentEnsName,
    expectedAgentEnsName,
    agentRegistrationState: getAgentRegistrationState({
      userEnsName,
      smartAccountAddress: agent?.smart_account_address ?? null,
      agentEnsName,
      expectedAgentEnsName,
      pending: Boolean(pendingAgentTransaction),
      agentResolvesToSmartWallet,
    }),
    pendingAgentTransaction,
    agentStats,
    activeStrategies: {
      public:
        (activeStrategies ?? []).find((strategy) => strategy.strategy_kind === "public") ?? null,
      secretSauce:
        (activeStrategies ?? []).find((strategy) => strategy.strategy_kind === "secret_sauce") ?? null,
    },
    textRecords,
  });
}

async function getPendingAgentBootstrapTransaction(
  supabase: ReturnType<typeof createAdminClient>,
  agentId: string,
) {
  const since = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("mcp_events")
    .select("event_type, payload, created_at")
    .eq("agent_id", agentId)
    .in("event_type", ["bootstrap.tx_submitted", "bootstrap.tx_confirmed"])
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(40);

  const confirmedIds = new Set<string>();
  for (const row of data ?? []) {
    if (row.event_type !== "bootstrap.tx_confirmed") continue;
    const payload =
      row.payload && typeof row.payload === "object"
        ? (row.payload as Record<string, unknown>)
        : {};
    const id =
      readPayloadString(payload, "userOperationHash") ??
      readPayloadString(payload, "transactionId") ??
      readPayloadString(payload, "txHash");
    if (id) confirmedIds.add(id);
  }

  for (const row of data ?? []) {
    if (row.event_type !== "bootstrap.tx_submitted") continue;
    const payload =
      row.payload && typeof row.payload === "object"
        ? (row.payload as Record<string, unknown>)
        : {};
    const id =
      readPayloadString(payload, "userOperationHash") ??
      readPayloadString(payload, "transactionId") ??
      readPayloadString(payload, "txHash");
    if (!id || confirmedIds.has(id)) continue;

    return {
      txHash: readPayloadString(payload, "txHash"),
      userOperationHash: readPayloadString(payload, "userOperationHash"),
      submittedAt: row.created_at,
    };
  }

  return null;
}

function readPayloadString(
  payload: Record<string, unknown>,
  key: string,
): string | null {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function getAgentRegistrationState(params: {
  userEnsName: string | null;
  smartAccountAddress: string | null;
  agentEnsName: string | null;
  expectedAgentEnsName: string | null;
  pending: boolean;
  agentResolvesToSmartWallet: boolean;
}): "blocked" | "action_required" | "pending" | "ready" {
  if (!params.userEnsName || !params.smartAccountAddress || !params.expectedAgentEnsName) {
    return "blocked";
  }

  if (
    params.agentEnsName === params.expectedAgentEnsName &&
    params.agentResolvesToSmartWallet
  ) {
    return "ready";
  }

  if (params.pending) {
    return "pending";
  }

  return "action_required";
}
