import { BASE_CHAIN_ID, type RiskTier, RISK_POLICIES } from "@moonjoy/game";
import { createAdminClient } from "@/lib/supabase/admin";

export type TokenInfo = {
  id: string;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  riskTier: RiskTier;
};

export async function getActiveTokensForMatch(
  matchId: string,
): Promise<TokenInfo[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("match_token_allowlists")
    .select("token_id, token_universe_tokens(*)")
    .eq("match_id", matchId);

  if (error) {
    throw new Error(`Failed to load match token allowlist: ${error.message}`);
  }

  const rows = data as unknown as Array<{
    token_id: string;
    token_universe_tokens: {
      id: string;
      address: string;
      symbol: string;
      name: string;
      decimals: number;
      risk_tier: RiskTier;
      is_active: boolean;
    };
  }>;

  return rows
    .filter((r) => r.token_universe_tokens?.is_active)
    .map((r) => ({
      id: r.token_universe_tokens.id,
      address: r.token_universe_tokens.address,
      symbol: r.token_universe_tokens.symbol,
      name: r.token_universe_tokens.name,
      decimals: r.token_universe_tokens.decimals,
      riskTier: r.token_universe_tokens.risk_tier,
    }));
}

export async function initializeMatchTokenAllowlist(matchId: string): Promise<void> {
  const supabase = createAdminClient();
  const { data: tokens, error: tokenError } = await supabase
    .from("token_universe_tokens")
    .select("id")
    .eq("chain_id", BASE_CHAIN_ID)
    .eq("is_active", true);

  if (tokenError || !tokens) {
    throw new Error(`Failed to load token universe: ${tokenError?.message}`);
  }

  const rows = (tokens as Array<{ id: string }>).map((t) => ({
    match_id: matchId,
    token_id: t.id,
    admitted_by: "system",
  }));

  if (rows.length === 0) return;

  const { error: insertError } = await supabase
    .from("match_token_allowlists")
    .upsert(rows, { onConflict: "match_id,token_id", ignoreDuplicates: true });

  if (insertError) {
    throw new Error(`Failed to initialize match token allowlist: ${insertError.message}`);
  }
}

export async function isTokenAllowedForMatch(
  matchId: string,
  tokenAddress: string,
): Promise<boolean> {
  const supabase = createAdminClient();
  const normalized = tokenAddress.toLowerCase();

  const { data } = await supabase
    .from("match_token_allowlists")
    .select("id")
    .eq("match_id", matchId)
    .limit(1)
    .maybeSingle();

  if (!data) return false;

  const { data: token } = await supabase
    .from("token_universe_tokens")
    .select("address")
    .eq("chain_id", BASE_CHAIN_ID)
    .eq("is_active", true)
    .limit(1);

  if (!token) return false;

  const { count } = await supabase
    .from("match_token_allowlists")
    .select("id", { count: "exact", head: true })
    .eq("match_id", matchId);

  if (count === 0) return false;

  const { data: match } = await supabase
    .from("match_token_allowlists")
    .select("token_id, token_universe_tokens!inner(address)")
    .eq("match_id", matchId)
    .limit(100);

  if (!match) return false;

  const rows = match as unknown as Array<{
    token_universe_tokens: { address: string };
  }>;

  return rows.some(
    (r) => r.token_universe_tokens.address.toLowerCase() === normalized,
  );
}

export function getTokenRiskTier(
  tokens: TokenInfo[],
  tokenAddress: string,
): RiskTier | null {
  const normalized = tokenAddress.toLowerCase();
  const token = tokens.find((t) => t.address.toLowerCase() === normalized);
  return token?.riskTier ?? null;
}

export function getPositionLimitPercent(riskTier: RiskTier): number {
  return RISK_POLICIES[riskTier].maxPositionPercent;
}

export function getMaxPriceImpactBps(riskTier: RiskTier): number {
  return RISK_POLICIES[riskTier].maxPriceImpactBps;
}

export function getSlippageBps(riskTier: RiskTier): number {
  return RISK_POLICIES[riskTier].slippageBps;
}

export async function addDiscoveredTokenToMatch(
  matchId: string,
  tokenAddress: string,
  symbol: string,
  name: string,
  decimals: number,
): Promise<void> {
  const supabase = createAdminClient();

  const { data: existing } = await supabase
    .from("token_universe_tokens")
    .select("id")
    .eq("chain_id", BASE_CHAIN_ID)
    .eq("address", tokenAddress)
    .maybeSingle();

  let tokenId: string;

  if (existing) {
    tokenId = (existing as { id: string }).id;
  } else {
    const { data: inserted, error } = await supabase
      .from("token_universe_tokens")
      .insert({
        chain_id: BASE_CHAIN_ID,
        address: tokenAddress,
        symbol,
        name,
        decimals,
        risk_tier: "discovered",
        source: "discovery",
      })
      .select("id")
      .single();

    if (error || !inserted) {
      throw new Error(`Failed to insert discovered token: ${error?.message}`);
    }
    tokenId = (inserted as { id: string }).id;
  }

  await supabase
    .from("match_token_allowlists")
    .upsert(
      {
        match_id: matchId,
        token_id: tokenId,
        admitted_by: "discovery",
      },
      { onConflict: "match_id,token_id", ignoreDuplicates: true },
    );
}
