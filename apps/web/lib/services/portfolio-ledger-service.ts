import { computePnlBreakdown, computeMaxDrawdownPercent } from "@moonjoy/game";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchValuationQuote } from "@/lib/services/uniswap-quote-service";

const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ZERO = BigInt(0);

export type LedgerBalance = {
  tokenAddress: string;
  amountBaseUnits: string;
};

export type BalanceDetail = {
  tokenAddress: string;
  symbol: string;
  decimals: number;
  amountBaseUnits: string;
  valueUsd: number;
  priceSource: string;
  quoteId: string | null;
};

export type ValuationResult = {
  startingValueUsd: number;
  currentValueUsd: number;
  usdcBalanceUsd: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  totalPnlUsd: number;
  pnlPercent: number;
  penaltiesUsd: number;
  penaltyImpactUsd: number;
  netScoreUsd: number;
  netScorePercent: number;
  maxDrawdownPercent: number;
  stale: boolean;
  quoteSnapshotIds: string[];
  balanceDetails: BalanceDetail[];
};

export async function initializeStartingBalances(
  matchId: string,
  agentId: string,
  startingCapitalUsd: number,
): Promise<void> {
  const supabase = createAdminClient();

  const { data: existing } = await supabase
    .from("portfolio_ledger_entries")
    .select("id")
    .eq("match_id", matchId)
    .eq("agent_id", agentId)
    .eq("entry_type", "starting_balance")
    .maybeSingle();

  if (existing) return;

  const usdcUnits = BigInt(Math.round(startingCapitalUsd * 1_000_000));

  await supabase.from("portfolio_ledger_entries").insert({
    match_id: matchId,
    agent_id: agentId,
    entry_type: "starting_balance",
    token_address: USDC_ADDRESS,
    amount_base_units: usdcUnits.toString(),
    value_usd: startingCapitalUsd,
    metadata: { source: "match_start" },
  });
}

export async function getTokenBalance(
  matchId: string,
  agentId: string,
  tokenAddress: string,
): Promise<string> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("portfolio_ledger_entries")
    .select("token_address, amount_base_units, entry_type")
    .eq("match_id", matchId)
    .eq("agent_id", agentId)
    .not("token_address", "is", null);

  if (error || !data) return "0";

  const normalized = tokenAddress.toLowerCase();
  let balance = ZERO;
  for (const entry of data as Array<{
    token_address?: string;
    amount_base_units: string;
    entry_type: string;
  }>) {
    if (entry.token_address?.toLowerCase() !== normalized) {
      continue;
    }

    const amount = BigInt(entry.amount_base_units);
    if (entry.entry_type === "trade_credit" || entry.entry_type === "starting_balance") {
      balance += amount;
    } else if (entry.entry_type === "trade_debit") {
      balance -= amount;
    }
  }

  return balance.toString();
}

export async function getAllBalances(
  matchId: string,
  agentId: string,
): Promise<LedgerBalance[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("portfolio_ledger_entries")
    .select("token_address, amount_base_units, entry_type")
    .eq("match_id", matchId)
    .eq("agent_id", agentId)
    .not("token_address", "is", null);

  if (error || !data) return [];

  const balances = new Map<string, bigint>();
  for (const entry of data as Array<{
    token_address: string;
    amount_base_units: string;
    entry_type: string;
  }>) {
    const token = entry.token_address.toLowerCase();
    const amount = BigInt(entry.amount_base_units);
    const current = balances.get(token) ?? ZERO;
    if (entry.entry_type === "trade_credit" || entry.entry_type === "starting_balance") {
      balances.set(token, current + amount);
    } else if (entry.entry_type === "trade_debit") {
      balances.set(token, current - amount);
    }
  }

  return Array.from(balances.entries())
    .filter(([, amount]) => amount > ZERO)
    .map(([tokenAddress, amount]) => ({
      tokenAddress,
      amountBaseUnits: amount.toString(),
    }));
}

export async function applyTradeLedger(
  matchId: string,
  agentId: string,
  tradeId: string,
  tokenIn: string,
  amountInBaseUnits: string,
  tokenOut: string,
  amountOutBaseUnits: string,
  inputValueUsd: number,
  outputValueUsd: number,
): Promise<void> {
  const supabase = createAdminClient();

  await supabase.from("portfolio_ledger_entries").insert([
    {
      match_id: matchId,
      agent_id: agentId,
      trade_id: tradeId,
      entry_type: "trade_debit",
      token_address: tokenIn,
      amount_base_units: amountInBaseUnits,
      value_usd: inputValueUsd,
      metadata: { tradeId },
    },
    {
      match_id: matchId,
      agent_id: agentId,
      trade_id: tradeId,
      entry_type: "trade_credit",
      token_address: tokenOut,
      amount_base_units: amountOutBaseUnits,
      value_usd: outputValueUsd,
      metadata: { tradeId },
    },
  ]);
}

export async function applyPenaltyLedger(
  matchId: string,
  agentId: string,
  penaltyUsd: number,
  windowName: string,
): Promise<void> {
  const supabase = createAdminClient();
  await supabase.from("portfolio_ledger_entries").insert({
    match_id: matchId,
    agent_id: agentId,
    entry_type: "penalty",
    value_usd: penaltyUsd,
    metadata: { windowName },
  });
}

export async function getTotalPenalties(
  matchId: string,
  agentId: string,
): Promise<number> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("portfolio_ledger_entries")
    .select("value_usd")
    .eq("match_id", matchId)
    .eq("agent_id", agentId)
    .eq("entry_type", "penalty");

  if (!data) return 0;
  return (data as Array<{ value_usd: number }>).reduce(
    (sum, e) => sum + (e.value_usd ?? 0),
    0,
  );
}

export async function getRealizedPnl(
  matchId: string,
  agentId: string,
): Promise<number> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("portfolio_ledger_entries")
    .select("value_usd, entry_type")
    .eq("match_id", matchId)
    .eq("agent_id", agentId)
    .in("entry_type", ["trade_credit", "trade_debit"]);

  if (!data) return 0;

  let credits = 0;
  let debits = 0;

  for (const entry of data as Array<{ value_usd: number | null; entry_type: string }>) {
    const val = entry.value_usd ?? 0;
    if (entry.entry_type === "trade_credit") credits += val;
    else if (entry.entry_type === "trade_debit") debits += val;
  }

  return credits - debits;
}

export async function computeValuation(
  matchId: string,
  agentId: string,
  phase: string,
  startingValueUsd: number,
  swapperAddress: string,
  options: { requireFresh?: boolean; final?: boolean } = {},
): Promise<ValuationResult> {
  const balances = await getAllBalances(matchId, agentId);
  const penaltiesUsd = await getTotalPenalties(matchId, agentId);
  const realizedPnlUsd = await getRealizedPnl(matchId, agentId);

  let currentValueUsd = 0;
  let usdcBalanceUsd = 0;
  let stale = false;
  const quoteSnapshotIds: string[] = [];
  const balanceDetails: BalanceDetail[] = [];
  const tokenInfoMap = await loadTokenInfoForBalances(balances);

  for (const balance of balances) {
    if (balance.tokenAddress.toLowerCase() === USDC_ADDRESS.toLowerCase()) {
      const usdcAmount = Number(balance.amountBaseUnits) / 1_000_000;
      currentValueUsd += usdcAmount;
      usdcBalanceUsd = usdcAmount;
      balanceDetails.push({
        tokenAddress: balance.tokenAddress,
        symbol: "USDC",
        decimals: 6,
        amountBaseUnits: balance.amountBaseUnits,
        valueUsd: usdcAmount,
        priceSource: "native",
        quoteId: null,
      });
      continue;
    }

    const quote = await fetchValuationQuote(
      balance.tokenAddress,
      balance.amountBaseUnits,
      swapperAddress,
    );

    const info = tokenInfoMap.get(balance.tokenAddress.toLowerCase());

    if (quote) {
      quoteSnapshotIds.push(quote.snapshotId);
      const valUsd = Number(quote.outputAmount) / 1_000_000;
      currentValueUsd += valUsd;
      balanceDetails.push({
        tokenAddress: balance.tokenAddress,
        symbol: info?.symbol ?? "",
        decimals: info?.decimals ?? 18,
        amountBaseUnits: balance.amountBaseUnits,
        valueUsd: valUsd,
        priceSource: "uniswap_quote",
        quoteId: quote.snapshotId,
      });
    } else {
      stale = true;
      if (options.final) {
        balanceDetails.push({
          tokenAddress: balance.tokenAddress,
          symbol: info?.symbol ?? "",
          decimals: info?.decimals ?? 18,
          amountBaseUnits: balance.amountBaseUnits,
          valueUsd: 0,
          priceSource: "none",
          quoteId: null,
        });
      } else {
        const lastValue = await getLastKnownValue(matchId, agentId, balance.tokenAddress);
        currentValueUsd += lastValue;
        balanceDetails.push({
          tokenAddress: balance.tokenAddress,
          symbol: info?.symbol ?? "",
          decimals: info?.decimals ?? 18,
          amountBaseUnits: balance.amountBaseUnits,
          valueUsd: lastValue,
          priceSource: "last_known",
          quoteId: null,
        });
      }
    }
  }

  const breakdown = computePnlBreakdown(
    startingValueUsd,
    currentValueUsd,
    realizedPnlUsd,
    penaltiesUsd,
  );

  const lastPeak = await getLastPeakValue(matchId, agentId);
  const maxDrawdownPercent = computeMaxDrawdownPercent(
    Math.max(lastPeak, currentValueUsd),
    currentValueUsd,
  );

  const result: ValuationResult = {
    startingValueUsd,
    currentValueUsd,
    usdcBalanceUsd,
    ...breakdown,
    maxDrawdownPercent,
    stale,
    quoteSnapshotIds,
    balanceDetails,
  };

  await storeValuationSnapshot(matchId, agentId, phase, result, startingValueUsd);

  return result;
}

async function storeValuationSnapshot(
  matchId: string,
  agentId: string,
  phase: string,
  result: ValuationResult,
  startingValueUsd: number,
): Promise<void> {
  const supabase = createAdminClient();
  await supabase.from("portfolio_valuation_snapshots").insert({
    match_id: matchId,
    agent_id: agentId,
    phase,
    starting_value_usd: startingValueUsd,
    current_value_usd: result.currentValueUsd,
    usdc_balance_usd: result.usdcBalanceUsd,
    realized_pnl_usd: result.realizedPnlUsd,
    unrealized_pnl_usd: result.unrealizedPnlUsd,
    total_pnl_usd: result.totalPnlUsd,
    pnl_percent: result.pnlPercent,
    penalties_usd: result.penaltiesUsd,
    net_score_percent: result.netScorePercent,
    max_drawdown_percent: result.maxDrawdownPercent,
    quote_snapshot_ids: result.quoteSnapshotIds,
    stale: result.stale,
    balances: result.balanceDetails,
  });
}

async function getLastKnownValue(
  matchId: string,
  agentId: string,
  tokenAddress: string,
): Promise<number> {
  const supabase = createAdminClient();
  const normalized = tokenAddress.toLowerCase();
  const { data } = await supabase
    .from("portfolio_valuation_snapshots")
    .select("balances")
    .eq("match_id", matchId)
    .eq("agent_id", agentId)
    .order("created_at", { ascending: false })
    .limit(5);

  if (!data) return 0;

  for (const snap of data) {
    const balances = snap.balances as BalanceDetail[] | null;
    if (!balances) continue;
    const entry = balances.find((b) => b.tokenAddress.toLowerCase() === normalized && b.valueUsd > 0);
    if (entry) return entry.valueUsd;
  }

  return 0;
}

async function loadTokenInfoForBalances(
  balances: LedgerBalance[],
): Promise<Map<string, { symbol: string; decimals: number }>> {
  if (balances.length === 0) return new Map();
  const supabase = createAdminClient();

  const { data } = await supabase
    .from("token_universe_tokens")
    .select("address, symbol, decimals");

  const map = new Map<string, { symbol: string; decimals: number }>();
  if (data) {
    for (const row of data as Array<{ address: string; symbol: string; decimals: number }>) {
      map.set(row.address.toLowerCase(), { symbol: row.symbol, decimals: row.decimals });
    }
  }
  return map;
}

async function getLastPeakValue(
  matchId: string,
  agentId: string,
): Promise<number> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("portfolio_valuation_snapshots")
    .select("current_value_usd")
    .eq("match_id", matchId)
    .eq("agent_id", agentId)
    .order("current_value_usd", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (data) {
    return Number((data as { current_value_usd: number }).current_value_usd);
  }
  return 0;
}
