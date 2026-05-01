import {
  requirePhaseThreeReadyUser,
  type UserAgentRecord,
} from "@/lib/services/mcp-auth-service";
import {
  checkMatchReadiness,
  requireMatchReadiness,
} from "@/lib/services/match-readiness-service";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveUser } from "@/lib/services/ens-resolution-service";
import { getFullNameForAddress, resolveAddress } from "@/lib/services/ens-service";
import { extractEnsLabel } from "@/lib/types/ens";
import type { Address } from "viem";

export type InviteScopeType = "open" | "ens";

export type CreateInviteInput = {
  scopeType: InviteScopeType;
  scopedEnsName?: string;
  wagerUsd?: number;
  durationSeconds?: number;
  warmupSeconds?: number;
};

export type InviteView = {
  id: string;
  inviteToken: string;
  scopeType: InviteScopeType;
  scopedEnsName: string | null;
  wagerUsd: number;
  durationSeconds: number;
  warmupSeconds: number;
  status: string;
  createdBy: {
    userId: string;
    agentId: string;
    smartAccountAddress: string;
    userEnsName: string;
    agentEnsName: string;
  };
  createdAt: string;
  expiresAt: string | null;
  inviteLink: string;
};

export class InviteServiceError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
  }
}

export async function createInvite(
  privyUserId: string,
  input: CreateInviteInput,
): Promise<InviteView> {
  const readinessResult = await checkMatchReadiness(privyUserId);
  requireMatchReadiness(readinessResult);

  const record = await requirePhaseThreeReadyUser(privyUserId);
  const actor = await buildActorFromRecord(record);

  if (input.scopeType === "ens") {
    if (!input.scopedEnsName) {
      throw new InviteServiceError("scopedEnsName is required for ens-scoped invites.", 400);
    }
    const normalized = normalizeEnsName(input.scopedEnsName);
    const resolution = await resolveEnsOnchain(normalized);
    if (!resolution || !resolution.address) {
      throw new InviteServiceError(
        `Cannot resolve ENS name: ${normalized}. Invite cannot be created.`,
        400,
      );
    }
  }

  const supabase = createAdminClient();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .rpc("create_match_invite", {
      p_created_by_user_id: actor.userId,
      p_creator_agent_id: actor.agentId,
      p_scope_type: input.scopeType,
      p_scoped_ens_name: input.scopeType === "ens" ? normalizeEnsName(input.scopedEnsName!) : null,
      p_wager_usd: input.wagerUsd ?? 10,
      p_duration_seconds: input.durationSeconds ?? 300,
      p_warmup_seconds: input.warmupSeconds ?? 30,
      p_expires_at: expiresAt,
    })
    .single();

  if (error || !data) {
    const msg = error?.code === "P0001"
      ? (error.message ?? "Invite creation failed.")
      : "Failed to create invite.";
    throw new InviteServiceError(msg, error?.code === "P0001" ? 409 : 500);
  }

  const row = data as Record<string, unknown>;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const inviteLink = `${baseUrl}/invite/${row.invite_token as string}`;

  return {
    id: row.id as string,
    inviteToken: row.invite_token as string,
    scopeType: row.scope_type as InviteScopeType,
    scopedEnsName: (row.scoped_ens_name as string) ?? null,
    wagerUsd: Number(row.wager_usd),
    durationSeconds: Number(row.duration_seconds),
    warmupSeconds: Number(row.warmup_seconds),
    status: row.status as string,
    createdBy: actor,
    createdAt: row.created_at as string,
    expiresAt: (row.expires_at as string) ?? null,
    inviteLink,
  };
}

export async function getInviteByToken(
  inviteToken: string,
): Promise<Record<string, unknown>> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("match_invites")
    .select("*")
    .eq("invite_token", inviteToken)
    .single();

  if (error || !data) {
    throw new InviteServiceError("Invite not found.", 404);
  }

  return data as Record<string, unknown>;
}

export async function joinInvite(
  privyUserId: string,
  inviteToken: string,
): Promise<{ matchId: string; status: string }> {
  const readinessResult = await checkMatchReadiness(privyUserId);
  requireMatchReadiness(readinessResult);

  const record = await requirePhaseThreeReadyUser(privyUserId);
  const actor = await buildActorFromRecord(record);

  const supabase = createAdminClient();

  const { data: invite, error: inviteError } = await supabase
    .from("match_invites")
    .select("id, status, expires_at, scope_type, scoped_ens_name, created_by_user_id, creator_agent_id, wager_usd, duration_seconds, warmup_seconds")
    .eq("invite_token", inviteToken)
    .single();

  if (inviteError || !invite) {
    throw new InviteServiceError("Invite not found.", 404);
  }

  const inviteRow = invite as Record<string, unknown>;

  if (inviteRow.status !== "open") {
    throw new InviteServiceError(`Invite is no longer open: status=${inviteRow.status}`, 409);
  }

  if (inviteRow.expires_at && new Date(inviteRow.expires_at as string) < new Date()) {
    throw new InviteServiceError("Invite has expired.", 410);
  }

  if ((inviteRow.created_by_user_id as string) === actor.userId) {
    throw new InviteServiceError("Cannot join your own invite.", 409);
  }

  if ((inviteRow.creator_agent_id as string) === actor.agentId) {
    throw new InviteServiceError("Cannot join your own invite.", 409);
  }

  if (inviteRow.scope_type === "ens") {
    const scopedEnsName = inviteRow.scoped_ens_name as string;
    const resolution = await resolveEnsOnchain(scopedEnsName);
    if (!resolution || !resolution.address) {
      throw new InviteServiceError(
        `Cannot resolve scoped ENS name: ${scopedEnsName}.`,
        403,
      );
    }
    const resolvedAddress = resolution.address.toLowerCase();
    const actorAddress = record.user.embedded_signer_address?.toLowerCase();
    if (!actorAddress || resolvedAddress !== actorAddress) {
      throw new InviteServiceError(
        `Only the controller of ${scopedEnsName} can join this invite.`,
        403,
      );
    }
  }

  const creatorSmartAccount = await getSmartAccountForAgent(inviteRow.creator_agent_id as string);

  const { data: result, error: joinError } = await supabase
    .rpc("join_match_invite", {
      p_invite_id: inviteRow.id as string,
      p_joiner_user_id: actor.userId,
      p_joiner_agent_id: actor.agentId,
      p_joiner_smart_account_address: actor.smartAccountAddress,
      p_creator_user_id: inviteRow.created_by_user_id as string,
      p_creator_agent_id: inviteRow.creator_agent_id as string,
      p_creator_smart_account_address: creatorSmartAccount,
      p_wager_usd: Number(inviteRow.wager_usd),
      p_duration_seconds: Number(inviteRow.duration_seconds),
      p_warmup_seconds: Number(inviteRow.warmup_seconds),
    })
    .single();

  if (joinError || !result) {
    const msg = joinError?.code === "P0001"
      ? (joinError.message ?? "Join failed.")
      : "Failed to join invite.";
    throw new InviteServiceError(msg, joinError?.code === "P0001" ? 409 : 500);
  }

  const joinResult = result as Record<string, unknown>;
  const matchId = joinResult.match_id as string;

  await supabase.from("match_events").insert({
    match_id: matchId,
    event_type: "invite.joined",
    payload: {
      inviteId: inviteRow.id,
      creatorAgentId: inviteRow.creator_agent_id,
      joinerAgentId: actor.agentId,
    },
  });

  return { matchId, status: "warmup" };
}

export async function revokeInvite(
  privyUserId: string,
  inviteId: string,
): Promise<void> {
  const supabase = createAdminClient();
  const { data: user } = await supabase
    .from("users")
    .select("id")
    .eq("privy_user_id", privyUserId)
    .maybeSingle();

  if (!user) {
    throw new InviteServiceError("User not found.", 404);
  }

  const { error } = await supabase
    .from("match_invites")
    .update({
      status: "revoked",
      updated_at: new Date().toISOString(),
    })
    .eq("id", inviteId)
    .eq("created_by_user_id", (user as Record<string, unknown>).id as string)
    .eq("status", "open");

  if (error) {
    throw new InviteServiceError("Failed to revoke invite.", 409);
  }
}

export async function getOpenInviteForUser(
  privyUserId: string,
): Promise<InviteView | null> {
  const record = await requirePhaseThreeReadyUser(privyUserId);
  const actor = await buildActorFromRecord(record);

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("match_invites")
    .select("id, invite_token, scope_type, scoped_ens_name, wager_usd, duration_seconds, warmup_seconds, status, created_at, expires_at")
    .eq("creator_agent_id", actor.agentId)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  const row = data as Record<string, unknown>;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  return {
    id: row.id as string,
    inviteToken: row.invite_token as string,
    scopeType: row.scope_type as InviteScopeType,
    scopedEnsName: (row.scoped_ens_name as string) ?? null,
    wagerUsd: Number(row.wager_usd),
    durationSeconds: Number(row.duration_seconds),
    warmupSeconds: Number(row.warmup_seconds),
    status: row.status as string,
    createdBy: actor,
    createdAt: row.created_at as string,
    expiresAt: (row.expires_at as string) ?? null,
    inviteLink: `${baseUrl}/invite/${row.invite_token as string}`,
  };
}

async function buildActorFromRecord(record: UserAgentRecord): Promise<{
  userId: string;
  agentId: string;
  smartAccountAddress: string;
  userEnsName: string;
  agentEnsName: string;
}> {
  const agentAddress = record.agent.smart_account_address;
  if (!agentAddress) {
    throw new InviteServiceError("Agent smart account is missing.", 409);
  }

  const [userResolution, agentEnsName] = await Promise.all([
    resolveUser(record.user.id),
    getFullNameForAddress(agentAddress as Address),
  ]);

  const userEnsName = userResolution.ensName;

  if (
    !userEnsName ||
    !userResolution.address ||
    !record.user.embedded_signer_address ||
    userResolution.address.toLowerCase() !==
      record.user.embedded_signer_address.toLowerCase()
  ) {
    throw new InviteServiceError(
      "User ENS must resolve onchain to the embedded signer before matches can begin.",
      409,
    );
  }

  if (!agentEnsName) {
    throw new InviteServiceError(
      "Agent ENS identity must resolve onchain before matches can begin.",
      409,
    );
  }

  return {
    userId: record.user.id,
    agentId: record.agent.id,
    smartAccountAddress: agentAddress,
    userEnsName,
    agentEnsName,
  };
}

async function getSmartAccountForAgent(agentId: string): Promise<string> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("agents")
    .select("smart_account_address")
    .eq("id", agentId)
    .single();
  const agent = data as Record<string, unknown> | null;
  if (!agent?.smart_account_address) {
    throw new InviteServiceError("Agent smart account not found.", 404);
  }
  return agent.smart_account_address as string;
}

function normalizeEnsName(name: string): string {
  return name.toLowerCase().trim();
}

async function resolveEnsOnchain(
  ensName: string,
): Promise<{ address: string | null } | null> {
  try {
    const label = extractEnsLabel(normalizeEnsName(ensName));
    if (!label) return null;
    const address = await resolveAddress(label);
    if (!address) return null;
    return { address };
  } catch {
    return null;
  }
}
