import { BASE_CHAIN_ID, DISCOVERY_DEFAULTS, type RiskTier } from "@moonjoy/game";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchExactInputQuote } from "@/lib/services/uniswap-quote-service";

const DEXSCREENER_BASE = "https://api.dexscreener.com";

type DexscreenerPair = {
  chainId: string;
  dexId: string;
  baseToken: { address: string; symbol: string; name: string };
  quoteToken: { address: string; symbol: string };
  liquidity: { usd: number } | null;
  volume: { h24: number } | null;
  txns: { h1: { buys: number; sells: number } } | null;
  pairCreatedAt: number | null;
  priceUsd: string | null;
};

export type DiscoveryFilter = {
  query?: string;
  minLiquidityUsd?: number;
  minVolume24hUsd?: number;
  minTxns1h?: number;
  maxAgeHours?: number;
};

export type DiscoveredToken = {
  address: string;
  symbol: string;
  name: string;
  riskTier: RiskTier;
  liquidityUsd: number;
  volume24hUsd: number;
  txns1h: number;
  priceUsd: number | null;
};

export type DiscoveryResult = {
  tokens: DiscoveredToken[];
  rejectedCount: number;
  rejectionReasons: Array<{ address: string; reason: string }>;
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

export async function discoverBaseTokens(
  filter: DiscoveryFilter = {},
  matchId?: string,
): Promise<DiscoveryResult> {
  const minLiquidity = filter.minLiquidityUsd ?? DISCOVERY_DEFAULTS.minLiquidityUsd;
  const minVolume = filter.minVolume24hUsd ?? DISCOVERY_DEFAULTS.minVolume24hUsd;
  const minTxns = filter.minTxns1h ?? DISCOVERY_DEFAULTS.minTxns1h;
  const maxAge = filter.maxAgeHours ?? DISCOVERY_DEFAULTS.minPairAgeHours;

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
      const pairs = batch.pairs as DexscreenerPair[] | undefined;
      rawPairs = pairs ?? [];
    }
  }

  const rejected: Array<{ address: string; reason: string }> = [];
  const grouped = groupByToken(rawPairs);
  const candidates: DiscoveredToken[] = [];

  for (const [address, pairs] of grouped) {
    const best = selectBestPair(pairs);
    if (!best) continue;

    const liquidity = best.liquidity?.usd ?? 0;
    const volume = best.volume?.h24 ?? 0;
    const txns = (best.txns?.h1?.buys ?? 0) + (best.txns?.h1?.sells ?? 0);

    if (liquidity < minLiquidity) {
      rejected.push({ address, reason: `Liquidity $${liquidity} < $${minLiquidity}` });
      continue;
    }
    if (volume < minVolume) {
      rejected.push({ address, reason: `Volume $${volume} < $${minVolume}` });
      continue;
    }
    if (txns < minTxns) {
      rejected.push({ address, reason: `Txns ${txns} < ${minTxns}` });
      continue;
    }
    if (best.pairCreatedAt) {
      const ageHours = (Date.now() - best.pairCreatedAt) / (1000 * 60 * 60);
      if (ageHours < maxAge) {
        rejected.push({ address, reason: `Pair age ${ageHours.toFixed(1)}h < ${maxAge}h` });
        continue;
      }
    } else {
      rejected.push({ address, reason: "Pair creation date unknown." });
      continue;
    }

    candidates.push({
      address,
      symbol: best.baseToken.symbol,
      name: best.baseToken.name,
      riskTier: "discovered",
      liquidityUsd: liquidity,
      volume24hUsd: volume,
      txns1h: txns,
      priceUsd: best.priceUsd ? parseFloat(best.priceUsd) : null,
    });
  }

  if (matchId) {
    await storeDiscoverySnapshot(matchId, filter.query, rawPairs, candidates, rejected);
  }

  return {
    tokens: candidates,
    rejectedCount: rejected.length,
    rejectionReasons: rejected,
  };
}

export async function getTokenRiskProfile(
  tokenAddress: string,
  swapperAddress: string,
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
  } | null;
  quoteAvailable: boolean;
}> {
  const supabase = createAdminClient();
  const { data: existing } = await supabase
    .from("token_universe_tokens")
    .select("symbol, name, risk_tier, decimals")
    .eq("chain_id", BASE_CHAIN_ID)
    .eq("address", tokenAddress)
    .eq("is_active", true)
    .maybeSingle();

  if (existing) {
    const pairData = await fetchDexscreener(
      `/token-pairs/v1/base/${tokenAddress}`,
    );
    const pairs = (pairData.pairs as DexscreenerPair[] | undefined) ?? [];
    const best = selectBestPair(pairs);

    let quoteAvailable = false;
    try {
      const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as `0x${string}`;
      await fetchExactInputQuote({
        swapper: swapperAddress as `0x${string}`,
        tokenIn: USDC,
        tokenOut: tokenAddress as `0x${string}`,
        amountBaseUnits: "1000000",
        slippageBps: 100,
      });
      quoteAvailable = true;
    } catch {}

    return {
      address: tokenAddress,
      symbol: existing.symbol,
      name: existing.name,
      riskTier: existing.risk_tier as RiskTier,
      pairSummary: best
        ? {
            liquidityUsd: best.liquidity?.usd ?? 0,
            volume24hUsd: best.volume?.h24 ?? 0,
            txns1h: (best.txns?.h1?.buys ?? 0) + (best.txns?.h1?.sells ?? 0),
            priceUsd: best.priceUsd ? parseFloat(best.priceUsd) : null,
          }
        : null,
      quoteAvailable,
    };
  }

  return {
    address: tokenAddress,
    symbol: null,
    name: null,
    riskTier: null,
    pairSummary: null,
    quoteAvailable: false,
  };
}

async function storeDiscoverySnapshot(
  matchId: string,
  query: string | undefined,
  rawPairs: DexscreenerPair[],
  filtered: DiscoveredToken[],
  rejected: Array<{ address: string; reason: string }>,
): Promise<void> {
  const supabase = createAdminClient();
  await supabase.from("token_discovery_snapshots").insert({
    match_id: matchId,
    query: query ?? null,
    raw_source: "dexscreener",
    raw_payload: rawPairs,
    filtered_payload: filtered,
    rejected_payload: rejected,
  });
}
