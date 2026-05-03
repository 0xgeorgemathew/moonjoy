import {
  requirePhaseThreeReadyUser,
  type UserAgentRecord,
} from "@/lib/services/mcp-auth-service";
import {
  checkMatchReadiness,
  requireMatchReadiness,
  type MatchReadinessResult,
} from "@/lib/services/match-readiness-service";
import {
  DEFAULT_MATCH_DURATION_SECONDS,
  DEFAULT_MATCH_WAGER_USD,
  DEFAULT_STARTING_USDC,
  DEFAULT_WARMUP_SECONDS,
} from "@moonjoy/game";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveUser } from "@/lib/services/ens-resolution-service";
import {
  getFullNameForAddress,
  resolveAddress,
  resolveTextRecord,
} from "@/lib/services/ens-service";
import { notifyMatchEventSessions } from "@/lib/services/mcp-session-notification-service";
import { extractEnsLabel } from "@/lib/types/ens";
import type { Address } from "viem";

export type InviteScopeType = "open" | "ens";

export const MATCH_CREATION_ARENA_PATH = "/match";
const MATCH_PREFERENCE_KEY = "moonjoy:match_preference";
const INVITE_EXPIRES_IN_MS = 24 * 60 * 60 * 1000;
const SUPPORTED_WAGER_USD = [DEFAULT_MATCH_WAGER_USD] as const;
const SUPPORTED_DURATION_SECONDS = [180, DEFAULT_MATCH_DURATION_SECONDS, 600] as const;
const SUPPORTED_STARTING_CAPITAL_USD = [DEFAULT_STARTING_USDC, 250, 500] as const;
const MIN_STARTING_CAPITAL_USD = 1;
const MAX_STARTING_CAPITAL_USD = 1_000_000;
const SUPPORTED_WARMUP_SECONDS = [DEFAULT_WARMUP_SECONDS] as const;

export type CreateInviteInput = {
  scopeType?: InviteScopeType;
  scopedEnsName?: string;
  wagerUsd?: number;
  durationSeconds?: number;
  startingCapitalUsd?: number;
  warmupSeconds?: number;
};

type ValidatedCreateInviteInput = {
  scopeType: InviteScopeType;
  scopedEnsName?: string;
  wagerUsd: number;
  durationSeconds: number;
  startingCapitalUsd: number;
  warmupSeconds: number;
};

export type InviteView = {
  id: string;
  inviteToken: string;
  scopeType: InviteScopeType;
  scopedEnsName: string | null;
  wagerUsd: number;
  durationSeconds: number;
  startingCapitalUsd: number;
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

export type JoinInviteResult = {
  matchId: string;
  status: "warmup";
  redirectPath: string;
};

export type MatchPreferenceRecord = {
  key: typeof MATCH_PREFERENCE_KEY;
  rawValue: string | null;
  parsed: {
    durationSeconds: number | null;
    wagerUsd: number | null;
    capitalUsd: {
      min: number | null;
      max: number | null;
    };
  };
  warnings: string[];
};

export type MatchCreationContext = {
  readiness: MatchReadinessResult["readiness"];
  ensPreference: MatchPreferenceRecord | null;
  suggestedTerms: {
    wagerUsd: number;
    durationSeconds: number;
    startingCapitalUsd: number;
    warmupSeconds: number;
  };
  requiredInputs: Array<
    "scopeType" | "scopedEnsName" | "wagerUsd" | "durationSeconds" | "startingCapitalUsd"
  >;
  constraints: {
    scopeTypes: readonly InviteScopeType[];
    wagerUsd: readonly number[];
    durationSeconds: readonly number[];
    startingCapitalUsd: readonly number[];
    warmupSeconds: readonly number[];
  };
  openInvite: InviteView | null;
  arenaPath: string;
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
  const terms = validateCreateInviteInput(input);
  const readinessResult = await checkMatchReadiness(privyUserId);
  requireMatchReadiness(readinessResult);

  const record = await requirePhaseThreeReadyUser(privyUserId);
  const actor = await buildActorFromRecord(record);

  if (terms.scopeType === "ens") {
    if (!terms.scopedEnsName) {
      throw new InviteServiceError("scopedEnsName is required for ens-scoped invites.", 400);
    }
    const normalized = normalizeEnsName(terms.scopedEnsName);
    const resolution = await resolveEnsOnchain(normalized);
    if (!resolution || !resolution.address) {
      throw new InviteServiceError(
        `Cannot resolve ENS name: ${normalized}. Invite cannot be created.`,
        400,
      );
    }
  }

  const supabase = createAdminClient();
  const expiresAt = new Date(Date.now() + INVITE_EXPIRES_IN_MS).toISOString();

  const { data, error } = await supabase
    .rpc("create_match_invite", {
      p_created_by_user_id: actor.userId,
      p_creator_agent_id: actor.agentId,
      p_scope_type: terms.scopeType,
      p_scoped_ens_name: terms.scopeType === "ens" ? normalizeEnsName(terms.scopedEnsName!) : null,
      p_wager_usd: terms.wagerUsd,
      p_duration_seconds: terms.durationSeconds,
      p_warmup_seconds: terms.warmupSeconds,
      p_starting_capital_usd: terms.startingCapitalUsd,
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
    startingCapitalUsd: Number(row.starting_capital_usd),
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
): Promise<JoinInviteResult> {
  const readinessResult = await checkMatchReadiness(privyUserId);
  requireMatchReadiness(readinessResult);

  const record = await requirePhaseThreeReadyUser(privyUserId);
  const actor = await buildActorFromRecord(record);

  const supabase = createAdminClient();

  const { data: invite, error: inviteError } = await supabase
    .from("match_invites")
    .select("id, status, expires_at, scope_type, scoped_ens_name, created_by_user_id, creator_agent_id, wager_usd, duration_seconds, warmup_seconds, starting_capital_usd")
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
      p_starting_capital_usd: Number(inviteRow.starting_capital_usd),
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
      redirectPath: MATCH_CREATION_ARENA_PATH,
    },
  });

  await notifyMatchEventSessions({
    agentIds: [inviteRow.creator_agent_id as string, actor.agentId],
    eventType: "invite.joined",
    matchId,
    status: "warmup",
    payload: {
      inviteId: inviteRow.id,
      redirectPath: MATCH_CREATION_ARENA_PATH,
      nextRecommendedTool: "moonjoy_match:action=heartbeat",
    },
  });
  await broadcastInviteJoined(matchId, inviteRow.creator_agent_id as string, actor.agentId);

  return {
    matchId,
    status: "warmup",
    redirectPath: MATCH_CREATION_ARENA_PATH,
  };
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
    .select("id, invite_token, scope_type, scoped_ens_name, wager_usd, duration_seconds, warmup_seconds, starting_capital_usd, status, created_at, expires_at")
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
    startingCapitalUsd: Number(row.starting_capital_usd),
    warmupSeconds: Number(row.warmup_seconds),
    status: row.status as string,
    createdBy: actor,
    createdAt: row.created_at as string,
    expiresAt: (row.expires_at as string) ?? null,
    inviteLink: `${baseUrl}/invite/${row.invite_token as string}`,
  };
}

export async function getMatchCreationContext(
  privyUserId: string,
): Promise<MatchCreationContext> {
  const readinessResult = await checkMatchReadiness(privyUserId);
  const ensPreference = await getEnsMatchPreference(readinessResult.userEnsName);
  const constraints = buildEffectiveConstraints(ensPreference);
  const suggestedTerms = buildSuggestedTerms(ensPreference, constraints);
  let openInvite: InviteView | null = null;
  if (readinessResult.ready) {
    try {
      openInvite = await getOpenInviteForUser(privyUserId);
    } catch {
      openInvite = null;
    }
  }

  return {
    readiness: readinessResult.readiness,
    ensPreference,
    suggestedTerms,
    requiredInputs: [
      "scopeType",
      "wagerUsd",
      "durationSeconds",
      "startingCapitalUsd",
    ],
    constraints: {
      scopeTypes: constraints.scopeTypes,
      wagerUsd: constraints.wagerUsd,
      durationSeconds: constraints.durationSeconds,
      startingCapitalUsd: constraints.startingCapitalUsd,
      warmupSeconds: constraints.warmupSeconds,
    },
    openInvite,
    arenaPath: MATCH_CREATION_ARENA_PATH,
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

function validateCreateInviteInput(input: CreateInviteInput): ValidatedCreateInviteInput {
  const scopeType = input.scopeType;
  if (scopeType !== "open" && scopeType !== "ens") {
    throw new InviteServiceError("scopeType must be 'open' or 'ens'.", 400);
  }

  const scopedEnsName = input.scopedEnsName?.trim() ?? "";
  if (scopeType === "ens" && !scopedEnsName) {
    throw new InviteServiceError("scopedEnsName is required for ENS-scoped matches.", 400);
  }

  if (scopeType === "open" && scopedEnsName) {
    throw new InviteServiceError("scopedEnsName is only allowed for ENS-scoped matches.", 400);
  }

  const wagerUsd = input.wagerUsd === undefined
    ? DEFAULT_MATCH_WAGER_USD
    : requireSupportedNumber(input.wagerUsd, SUPPORTED_WAGER_USD, "wagerUsd");
  const durationSeconds = input.durationSeconds === undefined
    ? DEFAULT_MATCH_DURATION_SECONDS
    : requireSupportedNumber(input.durationSeconds, SUPPORTED_DURATION_SECONDS, "durationSeconds");
  const startingCapitalUsd = input.startingCapitalUsd === undefined
    ? DEFAULT_STARTING_USDC
    : requireStartingCapitalUsd(input.startingCapitalUsd);
  const warmupSeconds = input.warmupSeconds === undefined
    ? DEFAULT_WARMUP_SECONDS
    : requireSupportedNumber(input.warmupSeconds, SUPPORTED_WARMUP_SECONDS, "warmupSeconds");

  return {
    scopeType,
    scopedEnsName: scopeType === "ens" ? scopedEnsName : undefined,
    wagerUsd,
    durationSeconds,
    startingCapitalUsd,
    warmupSeconds,
  };
}

function requireStartingCapitalUsd(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new InviteServiceError("startingCapitalUsd is required.", 400);
  }

  if (!Number.isInteger(value)) {
    throw new InviteServiceError("startingCapitalUsd must be a whole dollar amount.", 400);
  }

  if (value < MIN_STARTING_CAPITAL_USD || value > MAX_STARTING_CAPITAL_USD) {
    throw new InviteServiceError(
      `startingCapitalUsd must be between ${MIN_STARTING_CAPITAL_USD} and ${MAX_STARTING_CAPITAL_USD}.`,
      400,
    );
  }

  return value;
}

function requireSupportedNumber(
  value: number | undefined,
  supportedValues: readonly number[],
  fieldName: string,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new InviteServiceError(`${fieldName} is required.`, 400);
  }

  if (!Number.isInteger(value)) {
    throw new InviteServiceError(`${fieldName} must be an integer.`, 400);
  }

  if (!supportedValues.includes(value)) {
    throw new InviteServiceError(
      `${fieldName} must be one of: ${supportedValues.join(", ")}.`,
      400,
    );
  }

  return value;
}

async function getEnsMatchPreference(
  userEnsName: string,
): Promise<MatchPreferenceRecord | null> {
  if (!userEnsName) return null;

  const label = extractEnsLabel(userEnsName);
  if (!label) return null;

  try {
    const rawValue = await resolveTextRecord(label, MATCH_PREFERENCE_KEY);
    return parseMatchPreference(rawValue);
  } catch {
    return emptyMatchPreference(["Could not read ENS match preferences."]);
  }
}

function parseMatchPreference(
  rawValue: string | null,
  initialWarnings: string[] = [],
): MatchPreferenceRecord | null {
  if (!rawValue) return null;

  const warnings = [...initialWarnings];
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    return {
      key: MATCH_PREFERENCE_KEY,
      rawValue,
      parsed: {
        durationSeconds: null,
        wagerUsd: null,
        capitalUsd: { min: null, max: null },
      },
      warnings: ["ENS match preference is not valid JSON."],
    };
  }

  if (!parsed || typeof parsed !== "object") {
    warnings.push("ENS match preference must be a JSON object.");
  }

  const record = parsed && typeof parsed === "object"
    ? parsed as Record<string, unknown>
    : {};
  const capital = record.capitalUsd && typeof record.capitalUsd === "object"
    ? record.capitalUsd as Record<string, unknown>
    : {};

  return {
    key: MATCH_PREFERENCE_KEY,
    rawValue,
    parsed: {
      durationSeconds: parsePreferenceNumber(record.duration, "duration", warnings),
      wagerUsd: parsePreferenceNumber(record.wagerUsd, "wagerUsd", warnings),
      capitalUsd: {
        min: parsePreferenceNumber(capital.min, "capitalUsd.min", warnings),
        max: parsePreferenceNumber(capital.max, "capitalUsd.max", warnings),
      },
    },
    warnings,
  };
}

function emptyMatchPreference(warnings: string[]): MatchPreferenceRecord {
  return {
    key: MATCH_PREFERENCE_KEY,
    rawValue: null,
    parsed: {
      durationSeconds: null,
      wagerUsd: null,
      capitalUsd: { min: null, max: null },
    },
    warnings,
  };
}

function parsePreferenceNumber(
  value: unknown,
  fieldName: string,
  warnings: string[],
): number | null {
  if (value === undefined || value === null || value === "any") return null;

  const numericValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (!Number.isInteger(numericValue) || numericValue <= 0) {
    warnings.push(`${fieldName} must be "any" or a positive integer string.`);
    return null;
  }

  return numericValue;
}

function buildEffectiveConstraints(
  preference: MatchPreferenceRecord | null,
): MatchCreationContext["constraints"] {
  const durationSeconds = getPreferredValuesOrAll(
    preference?.parsed.durationSeconds,
    SUPPORTED_DURATION_SECONDS,
  );
  const wagerUsd = getPreferredValuesOrAll(
    preference?.parsed.wagerUsd,
    SUPPORTED_WAGER_USD,
  );
  const startingCapitalUsd = getCapitalValuesInPreferredRange(
    preference?.parsed.capitalUsd.min,
    preference?.parsed.capitalUsd.max,
  );

  return {
    scopeTypes: ["open", "ens"],
    wagerUsd,
    durationSeconds,
    startingCapitalUsd,
    warmupSeconds: SUPPORTED_WARMUP_SECONDS,
  };
}

function buildSuggestedTerms(
  preference: MatchPreferenceRecord | null,
  constraints: MatchCreationContext["constraints"],
): {
  wagerUsd: number;
  durationSeconds: number;
  startingCapitalUsd: number;
  warmupSeconds: number;
} {
  return {
    wagerUsd: getSupportedOrDefault(
      preference?.parsed.wagerUsd,
      constraints.wagerUsd,
      DEFAULT_MATCH_WAGER_USD,
    ),
    durationSeconds: getSupportedOrDefault(
      preference?.parsed.durationSeconds,
      constraints.durationSeconds,
      DEFAULT_MATCH_DURATION_SECONDS,
    ),
    startingCapitalUsd: getSupportedOrDefault(
      null,
      constraints.startingCapitalUsd,
      DEFAULT_STARTING_USDC,
    ),
    warmupSeconds: DEFAULT_WARMUP_SECONDS,
  };
}

function getPreferredValuesOrAll(
  value: number | null | undefined,
  supportedValues: readonly number[],
): readonly number[] {
  if (value && supportedValues.includes(value)) {
    return [value];
  }

  return supportedValues;
}

function getCapitalValuesInPreferredRange(
  minValue: number | null | undefined,
  maxValue: number | null | undefined,
): readonly number[] {
  const values = SUPPORTED_STARTING_CAPITAL_USD.filter((value) => {
    if (minValue && value < minValue) return false;
    if (maxValue && value > maxValue) return false;
    return true;
  });

  return values.length > 0 ? values : SUPPORTED_STARTING_CAPITAL_USD;
}

function getSupportedOrDefault(
  value: number | null | undefined,
  supportedValues: readonly number[],
  fallback: number,
): number {
  if (value && supportedValues.includes(value)) {
    return value;
  }

  if (supportedValues.includes(fallback)) {
    return fallback;
  }

  return supportedValues[0] ?? fallback;
}

async function broadcastInviteJoined(
  matchId: string,
  creatorAgentId: string,
  joinerAgentId: string,
): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    return;
  }

  const topics = [
    `agent:${creatorAgentId}:matches`,
    `agent:${joinerAgentId}:matches`,
    `match:${matchId}`,
  ];

  await Promise.all(
    topics.map(async (topic) => {
      try {
        await fetch(`${url}/rest/v1/rpc/broadcast`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({
            topic,
            event: "invite_joined",
            payload: {
              eventType: "invite.joined",
              matchId,
              status: "warmup",
              redirectPath: MATCH_CREATION_ARENA_PATH,
            },
            private: false,
          }),
        });
      } catch (error) {
        console.error("[invite] Failed to broadcast invite join", error);
      }
    }),
  );
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
