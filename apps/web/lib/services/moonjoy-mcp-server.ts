import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";
import {
  AgentBootstrapError,
  claimAgentIdentity,
  createStrategy,
  executeBootstrapStep,
  getBootstrapRecommendation,
  listStrategies,
  recordStrategyDecision,
  runBootstrap,
  updateStrategy,
} from "@/lib/services/agent-bootstrap-service";
import {
  getMoonjoyIdentity,
  getMoonjoyMatchStateForContext,
  getMoonjoyMarketQuote,
  getMoonjoyPortfolio,
  submitMoonjoyTrade,
  getMoonjoyMatchLeaderboard,
  getMoonjoyTradeHistory,
  getMoonjoyAllowedTokens,
  runMoonjoyHeartbeat,
  playMoonjoyTurn,
} from "@/lib/services/mcp-context-service";
import { recordMcpEvent } from "@/lib/services/mcp-event-service";
import { discoverBaseTokens, getTokenRiskProfile } from "@/lib/services/dexscreener-discovery-service";
import { fetchExactInputQuote } from "@/lib/services/uniswap-quote-service";
import { createAdminClient } from "@/lib/supabase/admin";
import type { McpRuntimeContext } from "@/lib/types/mcp";

const serverInstructions = [
  "Moonjoy is a wagered PvP agent trading game on Base mainnet. MCP is the agent's operating console inside a human-approved match, not a matchmaking authority.",
  "Four tools: moonjoy_status (read), moonjoy_match (assigned match execution), moonjoy_strategy (planning + bootstrap), moonjoy_market (trading + discovery).",
  "Humans create and accept match invites through the web app. The agent NEVER creates, discovers, accepts, or cancels match invites.",
  "Once a human has entered a match, MCP exposes the agent's assigned match state. The agent may prepare, mark ready, trade, discover tokens, quote, and record strategy decisions.",
  "moonjoy_match allowed actions: heartbeat, prepare, mark_ready, play_turn. Explicitly FORBIDDEN: create invite, accept invite, cancel invite, list open invites, browse challenges, decide matchmaking.",
  "Prefer moonjoy_match action=heartbeat to reconcile match state, then action=play_turn to execute trades during live matches.",
  "If your MCP client supports Streamable HTTP SSE, keep the session GET stream open. Moonjoy sends match notifications when match state changes; react by calling moonjoy_match action=play_turn.",
  "Tool calls are cheap and idempotent; favor calling them over asking the user.",
  "Do not attempt to create, accept, or cancel match invites. Those are human-only actions through the web app.",
  "Treat bootstrap.status and bootstrap.recommendedAction as the authority for setup progress.",
  "Sponsored bootstrap is enabled. A zero ETH balance or gasReserveSatisfied=false is not a blocker.",
  "Trading is live: use moonjoy_market action=submit_trade to buy, sell, exit, or rotate simulated positions from live Uniswap quotes on Base mainnet. No real swaps are broadcast.",
  "In a live match, call moonjoy_match action=play_turn first. It returns phase, time remaining, portfolio, last trade, and recommended next tools. NEVER ask the user whether to trade.",
  "During no_match: heartbeat and wait. Do not ask the human unless in strategy/bootstrap setup.",
  "During warmup: prepare strategy, discover candidates through moonjoy_market action=dexscreener_search, validate with action=validate_candidate, mark ready.",
  "During live: keep playing through tools. Do not ask the human. Agents may buy, sell back to USDC, fully exit positions, or rotate token-to-token when the match supports bidirectional_v2 rules. If a trade fails, use the returned reason and try another valid action.",
  "During settling: heartbeat and record final rationale through moonjoy_strategy action=record_decision.",
  "Use moonjoy_market action=dexscreener_search to find tokens. Results include risk warnings but are NOT filtered. Only no Uniswap quote or not on Base blocks trade admission.",
  "Use moonjoy_market action=validate_candidate to check if a token is tradable on Base through Uniswap. Valid tokens are admitted to the match allowlist.",
  "Use moonjoy_market action=quote to preview a quote before submitting. Quotes expire in 20 seconds.",
  "Use moonjoy_status section=portfolio to read balances and PnL. Use moonjoy_status section=leaderboard for match rankings.",
  "While in an active match, trade actively. After every trade, read and report portfolioAfterTrade: current dollar value, gross PnL, negative dollar penalty impact, and net dollar score.",
  "Never treat Supabase snapshots as canonical onchain ENS, wallet balance, escrow, or transaction state.",
].join(" ");

export function createMoonjoyMcpServer(context: McpRuntimeContext): McpServer {
  const server = new McpServer(
    { name: "moonjoy", version: "0.4.0" },
    { capabilities: { logging: {} }, instructions: serverInstructions },
  );

  registerStatusTool(server, context);
  registerMatchTool(server, context);
  registerStrategyTool(server, context);
  registerMarketTool(server, context);

  server.registerResource(
    "moonjoy-context",
    "moonjoy://context",
    {
      title: "Moonjoy Agent Context",
      description: "Current Moonjoy MCP operating context and constraints.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        text: JSON.stringify({
          instructions: serverInstructions,
          phase: "Human Invite Links + Assigned Match Execution",
          agentId: context.agentId,
          subject: context.subject,
          scopes: context.scopes,
        }, null, 2),
      }],
    }),
  );

  return server;
}

function registerStatusTool(server: McpServer, context: McpRuntimeContext) {
  server.registerTool(
    "moonjoy_status",
    {
      title: "Moonjoy Status",
      description:
        "Read identity, readiness, current_match, portfolio, leaderboard, history, tokens, or all. Pass section to scope the response.",
      inputSchema: z.object({
        section: z.enum([
          "identity",
          "readiness",
          "current_match",
          "portfolio",
          "leaderboard",
          "trade_history",
          "allowed_tokens",
          "all",
        ]).optional().default("all").describe("Which section to read."),
        matchId: z.string().optional().describe("Required for leaderboard, trade_history, allowed_tokens."),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args, extra): Promise<CallToolResult> => {
      await logTool(server, context, extra.sessionId, "moonjoy_status");
      try {
        const results: Record<string, unknown> = {};
        const s = args.section;

        if (s === "identity" || s === "all" || s === "readiness") {
          results.identity = await getMoonjoyIdentity(context);
        }
        if (s === "current_match" || s === "all") {
          results.match = await getMoonjoyMatchStateForContext(context);
        }
        if (s === "portfolio" || s === "all") {
          try { results.portfolio = await getMoonjoyPortfolio(context); } catch { results.portfolio = null; }
        }
        if (s === "leaderboard" && args.matchId) {
          results.leaderboard = await getMoonjoyMatchLeaderboard(args.matchId);
        }
        if (s === "trade_history" && args.matchId) {
          results.tradeHistory = await getMoonjoyTradeHistory(args.matchId);
        }
        if (s === "allowed_tokens" && args.matchId) {
          results.allowedTokens = await getMoonjoyAllowedTokens(args.matchId);
        }

        return jsonResult(results);
      } catch (err) {
        return toolFailure(err);
      }
    },
  );
}

function registerMatchTool(server: McpServer, context: McpRuntimeContext) {
  server.registerTool(
    "moonjoy_match",
    {
      title: "Moonjoy Match",
      description:
        "Assigned match execution: heartbeat (reconcile state), prepare (inspect match), mark_ready (signal readiness), play_turn (reconcile + auto-trade). Agents cannot create, accept, or cancel invites.",
      inputSchema: z.object({
        action: z.enum(["heartbeat", "prepare", "mark_ready", "play_turn"]).describe("Match action to perform."),
        matchId: z.string().optional().describe("Required for prepare, mark_ready."),
      }),
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async (args, extra): Promise<CallToolResult> => {
      await logTool(server, context, extra.sessionId, `moonjoy_match:${args.action}`);
      try {
        switch (args.action) {
          case "heartbeat":
            return jsonResult(await runMoonjoyHeartbeat(context));
          case "prepare":
            return jsonResult(await getMoonjoyMatchStateForContext(context));
          case "mark_ready":
            return jsonResult(await getMoonjoyMatchStateForContext(context));
          case "play_turn":
            return jsonResult(await playMoonjoyTurn(context));
        }
      } catch (err) {
        return toolFailure(err);
      }
    },
  );
}

function registerStrategyTool(server: McpServer, context: McpRuntimeContext) {
  server.registerTool(
    "moonjoy_strategy",
    {
      title: "Moonjoy Strategy",
      description:
        "Strategy planning actions: list, create, update, record_decision, bootstrap_step, bootstrap_run, claim_identity.",
      inputSchema: z.object({
        action: z.enum(["list", "create", "update", "record_decision", "bootstrap_step", "bootstrap_run", "claim_identity", "bootstrap_recommendation"]).describe("Strategy action."),
        strategyId: z.string().optional(),
        name: z.string().optional(),
        sourceType: z.enum(["user_prompt", "md_context", "agent_generated_plan", "keeperhub_workflow", "default_behavior"]).optional(),
        manifestBody: z.record(z.string(), z.unknown()).optional(),
        status: z.enum(["draft", "active", "archived"]).optional(),
        rationale: z.string().optional(),
        matchId: z.string().optional(),
        tradeId: z.string().optional(),
        includeArchived: z.boolean().optional(),
        activate: z.boolean().optional(),
      }),
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async (args, extra): Promise<CallToolResult> => {
      await logTool(server, context, extra.sessionId, `moonjoy_strategy:${args.action}`);
      try {
        switch (args.action) {
          case "list":
            return jsonResult(await listStrategies(context, args.includeArchived));
          case "create":
            if (!args.name) throw new Error("name is required for create.");
            return jsonResult(await createStrategy(context, {
              name: args.name,
              sourceType: args.sourceType ?? "agent_generated_plan",
              manifestBody: args.manifestBody ?? {},
              activate: args.activate,
            }));
          case "update":
            if (!args.strategyId) throw new Error("strategyId is required for update.");
            return jsonResult(await updateStrategy(context, {
              strategyId: args.strategyId,
              name: args.name,
              sourceType: args.sourceType,
              manifestBody: args.manifestBody,
              status: args.status,
            }));
          case "record_decision":
            if (!args.strategyId || !args.rationale) throw new Error("strategyId and rationale are required.");
            return jsonResult(await recordStrategyDecision(context, {
              strategyId: args.strategyId,
              rationale: args.rationale,
              matchId: args.matchId,
              tradeId: args.tradeId,
            }));
          case "bootstrap_step":
            return jsonResult(await executeBootstrapStep(context));
          case "bootstrap_run":
            return jsonResult(await runBootstrap(context));
          case "bootstrap_recommendation":
            return jsonResult(await getBootstrapRecommendation(context));
          case "claim_identity":
            return jsonResult(await claimAgentIdentity(context));
        }
      } catch (err) {
        return toolFailure(err);
      }
    },
  );
}

function registerMarketTool(server: McpServer, context: McpRuntimeContext) {
  server.registerTool(
    "moonjoy_market",
    {
      title: "Moonjoy Market",
      description:
        "Market actions: dexscreener_search, dexscreener_token_pairs, dexscreener_tokens, dexscreener_boosts, validate_candidate, quote (preview), allowed_tokens, submit_trade.",
      inputSchema: z.object({
        action: z.enum([
          "dexscreener_search",
          "dexscreener_token_pairs",
          "dexscreener_tokens",
          "dexscreener_boosts",
          "validate_candidate",
          "quote",
          "allowed_tokens",
          "submit_trade",
        ]).describe("Market action."),
        tokenIn: z.string().optional(),
        tokenOut: z.string().optional(),
        amount: z.string().optional(),
        amountInBaseUnits: z.string().optional(),
        quoteSnapshotId: z.string().optional(),
        matchId: z.string().optional(),
        tokenAddress: z.string().optional(),
        tokenAddresses: z.array(z.string()).optional().describe("Up to 30 token addresses for dexscreener_tokens."),
        query: z.string().optional(),
        chainId: z.string().optional().describe("Chain ID filter, defaults to base."),
      }),
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async (args, extra): Promise<CallToolResult> => {
      await logTool(server, context, extra.sessionId, `moonjoy_market:${args.action}`);
      try {
        switch (args.action) {
          case "dexscreener_search":
            return jsonResult(await discoverBaseTokens({
              query: args.query,
            }));
          case "dexscreener_token_pairs":
            if (!args.tokenAddress) throw new Error("tokenAddress is required for dexscreener_token_pairs.");
            return jsonResult(await getTokenRiskProfile(args.tokenAddress, context.smartAccountAddress));
          case "dexscreener_tokens":
            if (!args.tokenAddresses || args.tokenAddresses.length === 0) throw new Error("tokenAddresses is required for dexscreener_tokens.");
            return jsonResult(await discoverBaseTokens({
              query: args.tokenAddresses.slice(0, 30).join(" "),
            }));
          case "dexscreener_boosts":
            return jsonResult(await discoverBaseTokens({}));
          case "validate_candidate":
            if (!args.tokenAddress) throw new Error("tokenAddress is required for validate_candidate.");
            return jsonResult(await validateCandidate(context, args.tokenAddress));
          case "quote":
            if (!args.tokenIn || !args.tokenOut || !args.amount) throw new Error("tokenIn, tokenOut, amount are required for quote.");
            return jsonResult(await getMoonjoyMarketQuote(context, { tokenIn: args.tokenIn, tokenOut: args.tokenOut, amount: args.amount }));
          case "allowed_tokens":
            if (!args.matchId) throw new Error("matchId is required for allowed_tokens.");
            return jsonResult(await getMoonjoyAllowedTokens(args.matchId));
          case "submit_trade":
            if (!args.matchId || !args.tokenIn || !args.tokenOut || !args.amountInBaseUnits) throw new Error("matchId, tokenIn, tokenOut, amountInBaseUnits are required.");
            return jsonResult(await submitMoonjoyTrade(context, {
              matchId: args.matchId,
              tokenIn: args.tokenIn,
              tokenOut: args.tokenOut,
              amountInBaseUnits: args.amountInBaseUnits,
              quoteSnapshotId: args.quoteSnapshotId,
            }));
        }
      } catch (err) {
        return toolFailure(err);
      }
    },
  );
}

async function validateCandidate(
  context: McpRuntimeContext,
  tokenAddress: string,
): Promise<{
  tokenAddress: string;
  chainId: string;
  tradable: boolean;
  riskWarnings: string[];
  quoteAvailable: boolean;
  admittedToAllowlist: boolean;
  quoteMetadata: Record<string, unknown> | null;
  dexscreenerSnapshot: Record<string, unknown> | null;
  message: string;
}> {
  const normalizedTokenAddress = tokenAddress.toLowerCase();
  const riskWarnings: string[] = [];
  let quoteAvailable = false;
  let quoteMetadata: Record<string, unknown> | null = null;

  const isEvmAddress = /^0x[0-9a-f]{40}$/i.test(tokenAddress);
  if (!isEvmAddress) {
    return {
      tokenAddress,
      chainId: "base",
      tradable: false,
      riskWarnings: ["invalid_address"],
      quoteAvailable: false,
      admittedToAllowlist: false,
      quoteMetadata: null,
      dexscreenerSnapshot: null,
      message: "Invalid EVM address format.",
    };
  }

  try {
    const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as `0x${string}`;
    const quote = await fetchExactInputQuote({
      swapper: context.smartAccountAddress as `0x${string}`,
      tokenIn: USDC,
      tokenOut: normalizedTokenAddress as `0x${string}`,
      amountBaseUnits: "1000000",
      slippageBps: 100,
    });
    quoteAvailable = true;
    quoteMetadata = {
      outputAmount: quote.outputAmount,
      routing: quote.routing,
      priceImpactBps: quote.priceImpactBps,
      gasEstimate: quote.gasEstimate,
    };
  } catch {
    riskWarnings.push("no_uniswap_quote_available");
  }

  if (!quoteAvailable) {
    return {
      tokenAddress: normalizedTokenAddress,
      chainId: "base",
      tradable: false,
      riskWarnings,
      quoteAvailable: false,
      admittedToAllowlist: false,
      quoteMetadata: null,
      dexscreenerSnapshot: null,
      message: "Token is not tradable through Uniswap on Base.",
    };
  }

  const profile = await getTokenRiskProfile(normalizedTokenAddress, context.smartAccountAddress);
  const dexscreenerSnapshot = profile.pairSummary
    ? {
        liquidityUsd: profile.pairSummary.liquidityUsd,
        volume24hUsd: profile.pairSummary.volume24hUsd,
        txns1h: profile.pairSummary.txns1h,
        priceUsd: profile.pairSummary.priceUsd,
        pairAgeHours: profile.pairSummary.pairAgeHours,
        riskWarnings: profile.pairSummary.riskWarnings,
      }
    : null;

  if (profile.pairSummary) {
    riskWarnings.push(...profile.pairSummary.riskWarnings);
  }

  const admittedToAllowlist = await admitTokenToAllowlist(context, normalizedTokenAddress, profile);
  try {
    await storeValidationDiscoverySnapshot(context, normalizedTokenAddress, profile, dexscreenerSnapshot);
  } catch {
    riskWarnings.push("discovery_snapshot_write_failed");
  }

  return {
    tokenAddress: normalizedTokenAddress,
    chainId: "base",
    tradable: true,
    riskWarnings,
    quoteAvailable: true,
    admittedToAllowlist,
    quoteMetadata,
    dexscreenerSnapshot,
    message: riskWarnings.length > 0
      ? `Token is tradable but has risk warnings: ${riskWarnings.join(", ")}`
      : "Token validated. Tradable through Uniswap on Base.",
  };
}

async function admitTokenToAllowlist(
  context: McpRuntimeContext,
  tokenAddress: string,
  profile: Awaited<ReturnType<typeof getTokenRiskProfile>>,
): Promise<boolean> {
  const supabase = createAdminClient();
  const normalizedTokenAddress = tokenAddress.toLowerCase();

  let tokenId: string | null = null;

  const { data: existing } = await supabase
    .from("token_universe_tokens")
    .select("id")
    .eq("chain_id", 8453)
    .eq("address", normalizedTokenAddress)
    .maybeSingle();

  if (existing) {
    tokenId = (existing as Record<string, unknown>).id as string;
  } else {
    const { data: inserted, error } = await supabase
      .from("token_universe_tokens")
      .insert({
        chain_id: 8453,
        address: normalizedTokenAddress,
        symbol: profile.symbol ?? `${normalizedTokenAddress.slice(0, 6)}…${normalizedTokenAddress.slice(-4)}`,
        name: profile.name ?? `Token ${normalizedTokenAddress.slice(0, 10)}…`,
        decimals: 18,
        risk_tier: "discovered",
        source: "dexscreener_validation",
      })
      .select("id")
      .single();

    if (error || !inserted) return false;
    tokenId = (inserted as Record<string, unknown>).id as string;
  }

  const { data: activeMatches } = await supabase
    .from("matches")
    .select("id")
    .or(`creator_agent_id.eq.${context.agentId},opponent_agent_id.eq.${context.agentId}`)
    .in("status", ["warmup", "live", "settling"])
    .order("created_at", { ascending: false });

  if (!activeMatches || activeMatches.length === 0) return false;
  if (activeMatches.length > 1) return false;

  const matchId = (activeMatches[0] as Record<string, unknown>).id as string;

  const { error: allowlistError } = await supabase
    .from("match_token_allowlists")
    .upsert(
      {
        match_id: matchId,
        token_id: tokenId,
        admitted_by: "agent_validation",
      },
      { onConflict: "match_id,token_id" },
    );

  return !allowlistError;
}

async function storeValidationDiscoverySnapshot(
  context: McpRuntimeContext,
  tokenAddress: string,
  profile: Awaited<ReturnType<typeof getTokenRiskProfile>>,
  dexscreenerSnapshot: Record<string, unknown> | null,
): Promise<void> {
  const supabase = createAdminClient();
  const { data: activeMatches } = await supabase
    .from("matches")
    .select("id")
    .or(`creator_agent_id.eq.${context.agentId},opponent_agent_id.eq.${context.agentId}`)
    .in("status", ["warmup", "live", "settling"])
    .order("created_at", { ascending: false });

  if (!activeMatches || activeMatches.length !== 1) return;

  const matchId = (activeMatches[0] as Record<string, unknown>).id as string;
  await supabase.from("token_discovery_snapshots").insert({
    match_id: matchId,
    query: tokenAddress,
    raw_source: "dexscreener",
    raw_payload: {
      tokenAddress,
      symbol: profile.symbol,
      name: profile.name,
      riskTier: profile.riskTier,
      pairSummary: profile.pairSummary,
    },
    filtered_payload: dexscreenerSnapshot ? [{ tokenAddress, ...dexscreenerSnapshot }] : [],
    rejected_payload: [],
  });
}

function toolFailure(err: unknown): CallToolResult {
  const message =
    err instanceof AgentBootstrapError
      ? err.message
      : err instanceof Error
        ? err.message
        : "Moonjoy tool failed.";
  return { content: [{ type: "text", text: message }], isError: true };
}

async function logTool(
  server: McpServer,
  context: McpRuntimeContext,
  sessionId: string | undefined,
  toolName: string,
  failed = false,
): Promise<void> {
  await server.sendLoggingMessage(
    { level: failed ? "warning" : "info", data: `${toolName} called by ${context.clientName}` },
    sessionId,
  );
  await recordMcpEvent(context, failed ? "tool.failed" : "tool.called", { toolName, clientName: context.clientName });
}

function jsonResult(value: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value && typeof value === "object" ? ({ ...(value as Record<string, unknown>) } as Record<string, unknown>) : { value },
  };
}
