import { BASE_CHAIN_ID, type RiskTier } from "@moonjoy/game";
import { createAdminClient } from "@/lib/supabase/admin";

const DEXSCREENER_BASE = "https://api.dexscreener.com";

type DexscreenerPair = {
  chainId: string;
  dexId: string;
  pairAddress: string;
  baseToken: { address: string; symbol: string; name: string };
  quoteToken: { address: string; symbol: string };
  liquidity: { usd: number } | null;
  volume: { h24: number } | null;
  txns: { h1: { buys: number; sells: number } } | null;
  pairCreatedAt: number | null;
  priceUsd: string | null;
  boostId: string | null;
  profile: { links: Record<string, string> } | null;
};

export type DiscoveryFilter = {
  query?: string;
};

export type RawDiscoveredToken = {
  address: string;
  symbol: string;
  name: string;
  chainId: string;
  dexId: string;
  pairAddress: string;
  quoteTokenAddress: string;
  quoteTokenSymbol: string;
  liquidityUsd: number;
  volume24hUsd: number;
  txns1hBuys: number;
  txns1hSells: number;
  priceUsd: number | null;
  pairAgeHours: number | null;
  boostId: string | null;
  profileLinks: Record<string, string> | null;
  riskWarnings: string[];
};

export type DiscoveryResult = {
  tokens: RawDiscoveredToken[];
  warningCount: number;
  rawPairCount: number;
};

async function fetchDexscreener(
  endpoint: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${DEXSCREENER_BASE}${endpoint}`, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Dexscreener request failed: ${response.status}`);
  }

  return response.json() as Promise<Record<string, unknown>>;
}

function toChecksum(address: string): string {
  return address.toLowerCase();
}

function groupByToken(pairs: DexscreenerPair[]): Map<string, DexscreenerPair[]> {
  const map = new Map<string, DexscreenerPair[]>();
  for (const pair of pairs) {
    const key = toChecksum(pair.baseToken.address);
    const existing = map.get(key) ?? [];
    existing.push(pair);
    map.set(key, existing);
  }
  return map;
}

function selectBestPair(pairs: DexscreenerPair[]): DexscreenerPair | null {
  const sorted = [...pairs].sort((a, b) => {
    const liqA = a.liquidity?.usd ?? 0;
    const liqB = b.liquidity?.usd ?? 0;
    if (liqB !== liqA) return liqB - liqA;
    return (b.volume?.h24 ?? 0) - (a.volume?.h24 ?? 0);
  });
  return sorted[0] ?? null;
}

function computeWarnings(pair: DexscreenerPair): string[] {
  const warnings: string[] = [];
  const liquidity = pair.liquidity?.usd ?? 0;
  const volume = pair.volume?.h24 ?? 0;
  const txns = (pair.txns?.h1?.buys ?? 0) + (pair.txns?.h1?.sells ?? 0);

  if (liquidity < 10_000) warnings.push("low_liquidity");
  if (volume < 1_000) warnings.push("low_24h_volume");
  if (txns < 5) warnings.push("low_1h_txn_count");

  if (pair.pairCreatedAt) {
    const ageHours = (Date.now() - pair.pairCreatedAt) / (1000 * 60 * 60);
    if (ageHours < 24) warnings.push("new_pair");
  } else {
    warnings.push("unknown_pair_age");
  }

  if (pair.boostId) warnings.push("boosted_listing");

  return warnings;
}

export async function discoverBaseTokens(
  filter: DiscoveryFilter = {},
  matchId?: string,
): Promise<DiscoveryResult> {
  let rawPairs: DexscreenerPair[] = [];

  if (filter.query) {
    const data = await fetchDexscreener(
      `/latest/dex/search?q=${encodeURIComponent(filter.query)}`,
    );
    const pairs = data.pairs as DexscreenerPair[] | undefined;
    rawPairs = (pairs ?? []).filter((p) => p.chainId === "base");
  } else {
    const data = await fetchDexscreener("/token-boosts/top/v1");
    const tokens = data as unknown as Array<{ tokenAddress: string; chainId: string }>;
    const baseTokens = (tokens ?? [])
      .filter((t) => t.chainId === "base")
      .map((t) => t.tokenAddress);

    if (baseTokens.length > 0) {
      const batch = await fetchDexscreener(
        `/tokens/v1/base/${baseTokens.slice(0, 30).join(",")}`,
      );
      if (Array.isArray(batch)) {
        rawPairs = batch as unknown as DexscreenerPair[];
      } else {
        const pairs = batch.pairs as DexscreenerPair[] | undefined;
        rawPairs = pairs ?? [];
      }
    }
  }

  const grouped = groupByToken(rawPairs);
  const candidates: RawDiscoveredToken[] = [];
  let warningCount = 0;

  for (const [_address, pairs] of grouped) {
    const best = selectBestPair(pairs);
    if (!best) continue;

    const riskWarnings = computeWarnings(best);
    if (riskWarnings.length > 0) warningCount++;

    const pairAgeHours = best.pairCreatedAt
      ? (Date.now() - best.pairCreatedAt) / (1000 * 60 * 60)
      : null;

    candidates.push({
      address: toChecksum(best.baseToken.address),
      symbol: best.baseToken.symbol,
      name: best.baseToken.name,
      chainId: best.chainId,
      dexId: best.dexId,
      pairAddress: best.pairAddress,
      quoteTokenAddress: toChecksum(best.quoteToken.address),
      quoteTokenSymbol: best.quoteToken.symbol,
      liquidityUsd: best.liquidity?.usd ?? 0,
      volume24hUsd: best.volume?.h24 ?? 0,
      txns1hBuys: best.txns?.h1?.buys ?? 0,
      txns1hSells: best.txns?.h1?.sells ?? 0,
      priceUsd: best.priceUsd ? parseFloat(best.priceUsd) : null,
      pairAgeHours,
      boostId: best.boostId ?? null,
      profileLinks: best.profile?.links ?? null,
      riskWarnings,
    });
  }

  if (matchId) {
    await storeDiscoverySnapshot(matchId, filter.query, rawPairs, candidates);
  }

  return {
    tokens: candidates,
    warningCount,
    rawPairCount: rawPairs.length,
  };
}

export async function getTokenRiskProfile(
  tokenAddress: string,
  _swapperAddress: string,
): Promise<{
  address: string;
  symbol: string | null;
  name: string | null;
  riskTier: RiskTier | null;
  pairSummary: {
    liquidityUsd: number;
    volume24hUsd: number;
    txns1h: number;
    priceUsd: number | null;
    pairAddress: string;
    dexId: string;
    pairAgeHours: number | null;
    riskWarnings: string[];
  } | null;
}> {
  const supabase = createAdminClient();
  const { data: existing } = await supabase
    .from("token_universe_tokens")
    .select("symbol, name, risk_tier, decimals")
    .eq("chain_id", BASE_CHAIN_ID)
    .eq("address", tokenAddress)
    .eq("is_active", true)
    .maybeSingle();

  let symbol = existing ? (existing as Record<string, unknown>).symbol as string : null;
  let name = existing ? (existing as Record<string, unknown>).name as string : null;
  const riskTier = existing ? (existing as Record<string, unknown>).risk_tier as RiskTier : null;

  const pairData = await fetchDexscreener(
    `/token-pairs/v1/base/${tokenAddress}`,
  );
  let pairs: DexscreenerPair[];
  if (Array.isArray(pairData)) {
    pairs = pairData as unknown as DexscreenerPair[];
  } else {
    pairs = (pairData.pairs as DexscreenerPair[] | undefined) ?? [];
  }
  const best = selectBestPair(pairs);

  // Dexscreener always has the actual symbol — use it when DB is missing or "UNKNOWN"
  if (best && (!symbol || symbol === "UNKNOWN")) {
    symbol = best.baseToken.symbol || null;
  }
  if (best && (!name || name === "Unknown Token")) {
    name = best.baseToken.name || null;
  }

  // If we resolved a better symbol from Dexscreener, update the stale DB row
  if (symbol && existing && ((existing as Record<string, unknown>).symbol as string) === "UNKNOWN") {
    const supabase2 = createAdminClient();
    await supabase2
      .from("token_universe_tokens")
      .update({ symbol, name: name ?? null })
      .eq("chain_id", BASE_CHAIN_ID)
      .eq("address", tokenAddress);
  }

  if (best) {
    const riskWarnings = computeWarnings(best);
    const pairAgeHours = best.pairCreatedAt
      ? (Date.now() - best.pairCreatedAt) / (1000 * 60 * 60)
      : null;

    return {
      address: tokenAddress,
      symbol,
      name,
      riskTier,
      pairSummary: {
        liquidityUsd: best.liquidity?.usd ?? 0,
        volume24hUsd: best.volume?.h24 ?? 0,
        txns1h: (best.txns?.h1?.buys ?? 0) + (best.txns?.h1?.sells ?? 0),
        priceUsd: best.priceUsd ? parseFloat(best.priceUsd) : null,
        pairAddress: best.pairAddress,
        dexId: best.dexId,
        pairAgeHours,
        riskWarnings,
      },
    };
  }

  return {
    address: tokenAddress,
    symbol,
    name,
    riskTier,
    pairSummary: null,
  };
}

async function storeDiscoverySnapshot(
  matchId: string,
  query: string | undefined,
  rawPairs: DexscreenerPair[],
  candidates: RawDiscoveredToken[],
): Promise<void> {
  const supabase = createAdminClient();
  await supabase.from("token_discovery_snapshots").insert({
    match_id: matchId,
    query: query ?? null,
    raw_source: "dexscreener",
    raw_payload: rawPairs,
    filtered_payload: candidates,
    rejected_payload: [],
  });
}
