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
  acceptMoonjoyChallengeForContext,
  autoAdvanceMoonjoy,
  cancelMoonjoyChallengeForContext,
  createMoonjoyChallengeForContext,
  getMoonjoyIdentity,
  getMoonjoyMatchStateForContext,
  getMoonjoyMarketQuote,
  getMoonjoyPortfolio,
  listMoonjoyOpenChallengesForContext,
  submitMoonjoyTrade,
  discoverMoonjoyTokens,
  getMoonjoyTokenRiskProfile,
  getMoonjoyMatchLeaderboard,
  getMoonjoyTradeHistory,
  getMoonjoyAllowedTokens,
  runMoonjoyHeartbeat,
  playMoonjoyTurn,
} from "@/lib/services/mcp-context-service";
import { recordMcpEvent } from "@/lib/services/mcp-event-service";
import type { McpRuntimeContext } from "@/lib/types/mcp";

const serverInstructions = [
  "Moonjoy is a wagered PvP agent trading game on Base mainnet. MCP is the only control surface.",
  "Prefer moonjoy_auto as the default tool: it reads ENS-backed identity, finishes bootstrap only when needed, analyzes open challenges, accepts a joinable challenge, or creates one in a single call.",
  "If your MCP client supports Streamable HTTP SSE, keep the session GET stream open. Moonjoy sends moonjoy.match notifications when match state changes; react by calling moonjoy_auto.",
  "Tool calls are cheap and idempotent; favor calling them over asking the user.",
  "Never ask the user for permission to bootstrap, create a challenge, or accept a challenge. Those are agent actions.",
  "Do not stop just because moonjoy_auto returns status=ready_waiting. If nextRecommendedTools are present, use them without asking the user.",
  "Treat bootstrap.status and bootstrap.recommendedAction as the authority for setup progress.",
  "Sponsored bootstrap is enabled. A zero ETH balance or gasReserveSatisfied=false is not a blocker.",
  "Trading is live: use moonjoy_submit_trade to execute simulated fills from live Uniswap quotes on Base mainnet. No real swaps are broadcast.",
  "In a live match, call moonjoy_play_turn first. If it cannot trade immediately, use the returned nextRecommendedTools directly; never ask the user whether to trade.",
  "Use moonjoy_discover_base_tokens to find tradable tokens beyond the curated list. Filter by liquidity and volume.",
  "Use moonjoy_get_market_quote to preview a quote before submitting. Quotes expire in 20 seconds.",
  "Use moonjoy_get_portfolio to read balances and PnL. Use moonjoy_get_leaderboard for match rankings.",
  "When waiting between match state changes, use moonjoy_heartbeat, moonjoy_discover_base_tokens, moonjoy_get_token_risk_profile, moonjoy_get_market_quote, portfolio, leaderboard, and strategy decision tools instead of stopping or asking the user.",
  "If two agents both posted open challenges, the earliest created match wins. That creator holds; the later creator cancels its own match and accepts the earlier one.",
  "Mandatory trading windows require at least one trade each in the first 60s and last 60s. Missing a window costs 2.5% of starting portfolio.",
  "If no active match exists, discover joinable challenges and enter one; if none exists, create a fresh challenge.",
  "While in an active match, trade actively. After every trade, read and report portfolioAfterTrade: current dollar value, gross PnL, negative dollar penalty impact, and net dollar score.",
  "Never treat Supabase snapshots as canonical onchain ENS, wallet balance, escrow, or transaction state.",
].join(" ");

export function createMoonjoyMcpServer(context: McpRuntimeContext): McpServer {
  const server = new McpServer(
    {
      name: "moonjoy",
      version: "0.3.0",
    },
    {
      capabilities: {
        logging: {},
      },
      instructions: serverInstructions,
    },
  );

  server.registerTool(
    "moonjoy_auto",
    {
      title: "Auto Advance",
      description:
        "One-call agent driver. Reads ENS-backed identity, finishes bootstrap if actionable, analyzes open challenges, accepts a compatible challenge if one exists, otherwise posts a fresh $10 challenge. Returns the resulting identity, match, and executed actions. Safe to call repeatedly; it will no-op only when already active in a match or blocked.",
      inputSchema: z.object({
        skipMatchActions: z
          .boolean()
          .optional()
          .describe(
            "If true, only runs identity + bootstrap and skips any match create/accept actions.",
          ),
      }),
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
      },
    },
    async (args, extra): Promise<CallToolResult> => {
      await logTool(server, context, extra.sessionId, "moonjoy_auto");
      return runTool(() => autoAdvanceMoonjoy(context, args));
    },
  );

  server.registerTool(
    "moonjoy_get_identity",
    {
      title: "Get Moonjoy Identity",
      description:
        "Read the approved user's ENS identity, agent smart account, MCP approval, bootstrap readiness, next allowed actions, and whether bootstrap should be auto-run now. Treat bootstrap readiness as authoritative over funding warnings.",
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (_args, extra): Promise<CallToolResult> => {
      await logTool(server, context, extra.sessionId, "moonjoy_get_identity");
      const identity = await getMoonjoyIdentity(context);
      return jsonResult(identity);
    },
  );

  server.registerTool(
    "moonjoy_get_bootstrap_action",
    {
      title: "Get Bootstrap Action",
      description:
        "Return the exact next bootstrap action the agent should take, including the recommended tool name, arguments, and whether the step is blocked or directly executable.",
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (_args, extra): Promise<CallToolResult> => {
      await logTool(server, context, extra.sessionId, "moonjoy_get_bootstrap_action");
      return runTool(() => getBootstrapRecommendation(context));
    },
  );

  server.registerTool(
    "moonjoy_run_bootstrap",
    {
      title: "Run Bootstrap",
      description:
        "Execute all immediately actionable Phase 4 bootstrap steps in sequence until the agent is ready or a real blocker is reached. Prefer this over manual step selection.",
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
      },
    },
    async (_args, extra): Promise<CallToolResult> => {
      await logTool(server, context, extra.sessionId, "moonjoy_run_bootstrap");
      return runTool(() => runBootstrap(context));
    },
  );

  server.registerTool(
    "moonjoy_execute_bootstrap_step",
    {
      title: "Execute Bootstrap Step",
      description:
        "Take only the next recommended bootstrap action. Prefer moonjoy_run_bootstrap for normal operation so the agent keeps moving until blocked or ready.",
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
      },
    },
    async (_args, extra): Promise<CallToolResult> => {
      await logTool(server, context, extra.sessionId, "moonjoy_execute_bootstrap_step");
      return runTool(() => executeBootstrapStep(context));
    },
  );

  server.registerTool(
    "moonjoy_get_match_state",
    {
      title: "Get Match State",
      description: "Read the current match state for the approved Moonjoy agent.",
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (_args, extra): Promise<CallToolResult> => {
      await logTool(server, context, extra.sessionId, "moonjoy_get_match_state");
      return jsonResult(await getMoonjoyMatchStateForContext(context));
    },
  );

  server.registerTool(
    "moonjoy_list_open_challenges",
    {
      title: "List Open Challenges",
      description:
        "List open Moonjoy challenges that this approved agent can accept.",
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (_args, extra): Promise<CallToolResult> => {
      await logTool(server, context, extra.sessionId, "moonjoy_list_open_challenges");
      return jsonResult(await listMoonjoyOpenChallengesForContext(context));
    },
  );

  server.registerTool(
    "moonjoy_create_challenge",
    {
      title: "Create Challenge",
      description:
        "Post a new open $10 Moonjoy challenge from the approved agent. The UI will observe the new challenge automatically.",
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
      },
    },
    async (_args, extra): Promise<CallToolResult> => {
      await logTool(server, context, extra.sessionId, "moonjoy_create_challenge");
      return runTool(() => createMoonjoyChallengeForContext(context));
    },
  );

  server.registerTool(
    "moonjoy_accept_challenge",
    {
      title: "Accept Challenge",
      description:
        "Accept an open Moonjoy challenge by id. Acceptance starts warmup immediately.",
      inputSchema: z.object({
        matchId: z.string(),
      }),
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
      },
    },
    async (args, extra): Promise<CallToolResult> => {
      await logTool(server, context, extra.sessionId, "moonjoy_accept_challenge");
      return runTool(() => acceptMoonjoyChallengeForContext(context, args.matchId));
    },
  );

  server.registerTool(
    "moonjoy_cancel_challenge",
    {
      title: "Cancel Challenge",
      description:
        "Withdraw this agent's own open, unaccepted challenge. Use this when the agent should join another open challenge instead of waiting.",
      inputSchema: z.object({
        matchId: z.string(),
      }),
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
      },
    },
    async (args, extra): Promise<CallToolResult> => {
      await logTool(server, context, extra.sessionId, "moonjoy_cancel_challenge");
      return runTool(() => cancelMoonjoyChallengeForContext(context, args.matchId));
    },
  );

  server.registerTool(
    "moonjoy_get_portfolio",
    {
      title: "Get Portfolio",
      description:
        "Read current simulated portfolio balances and PnL for the active match.",
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (_args, extra): Promise<CallToolResult> => {
      await logTool(server, context, extra.sessionId, "moonjoy_get_portfolio");
      return jsonResult(await getMoonjoyPortfolio(context));
    },
  );

  server.registerTool(
    "moonjoy_heartbeat",
    {
      title: "Heartbeat",
      description:
        "Run one Moonjoy heartbeat tick. Reconciles match state, accepts a coordinated joinable challenge when safe, and advances live-match auto play. It will not create a new challenge.",
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
      },
    },
    async (_args, extra): Promise<CallToolResult> => {
      await logTool(server, context, extra.sessionId, "moonjoy_heartbeat");
      return runTool(() => runMoonjoyHeartbeat(context));
    },
  );

  server.registerTool(
    "moonjoy_play_turn",
    {
      title: "Play Turn",
      description:
        "Play one Moonjoy turn for the approved agent. Best first tool during a live match: reconciles state, performs an automatic safe trade when available, and returns live-match follow-up tools when no immediate trade is possible. It will not create a new challenge.",
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
      },
    },
    async (_args, extra): Promise<CallToolResult> => {
      await logTool(server, context, extra.sessionId, "moonjoy_play_turn");
      return runTool(() => playMoonjoyTurn(context));
    },
  );

  server.registerTool(
    "moonjoy_claim_agent_identity",
    {
      title: "Claim Agent Identity",
      description:
        "Claim or refresh the derived agent ENS identity and required public ENS records for the approved Moonjoy agent.",
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
      },
    },
    async (_args, extra): Promise<CallToolResult> => {
      await logTool(server, context, extra.sessionId, "moonjoy_claim_agent_identity");
      return runTool(() => claimAgentIdentity(context));
    },
  );

  server.registerTool(
    "moonjoy_create_strategy",
    {
      title: "Create Strategy",
      description:
        "Create a user-owned strategy for the approved agent. The first strategy becomes the default unless activate is set to false.",
      inputSchema: z.object({
        name: z.string(),
        sourceType: z.enum([
          "user_prompt",
          "md_context",
          "agent_generated_plan",
          "keeperhub_workflow",
          "default_behavior",
        ]),
        manifestBody: z.record(z.string(), z.unknown()),
        activate: z.boolean().optional(),
        publishPublicPointer: z.boolean().optional(),
      }),
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
      },
    },
    async (args, extra): Promise<CallToolResult> => {
      await logTool(server, context, extra.sessionId, "moonjoy_create_strategy");
      return runTool(() => createStrategy(context, args));
    },
  );

  server.registerTool(
    "moonjoy_update_strategy",
    {
      title: "Update Strategy",
      description:
        "Update an existing user-owned strategy, optionally activate it, and optionally republish its public ENS pointer.",
      inputSchema: z.object({
        strategyId: z.string(),
        name: z.string().optional(),
        sourceType: z
          .enum([
            "user_prompt",
            "md_context",
            "agent_generated_plan",
            "keeperhub_workflow",
            "default_behavior",
          ])
          .optional(),
        manifestBody: z.record(z.string(), z.unknown()).optional(),
        status: z.enum(["draft", "active", "archived"]).optional(),
        publishPublicPointer: z.boolean().optional(),
      }),
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
      },
    },
    async (args, extra): Promise<CallToolResult> => {
      await logTool(server, context, extra.sessionId, "moonjoy_update_strategy");
      return runTool(() => updateStrategy(context, args));
    },
  );

  server.registerTool(
    "moonjoy_list_strategies",
    {
      title: "List Strategies",
      description:
        "List strategies owned by the approved user and assigned to the approved agent.",
      inputSchema: z.object({
        includeArchived: z.boolean().optional(),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (args, extra): Promise<CallToolResult> => {
      await logTool(server, context, extra.sessionId, "moonjoy_list_strategies");
      return runTool(() => listStrategies(context, args.includeArchived));
    },
  );

  server.registerTool(
    "moonjoy_record_strategy_decision",
    {
      title: "Record Strategy Decision",
      description:
        "Record why a strategy influenced an action so later match replay and attribution remain explicit.",
      inputSchema: z.object({
        strategyId: z.string(),
        rationale: z.string(),
        matchId: z.string().optional(),
        tradeId: z.string().optional(),
      }),
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
      },
    },
    async (args, extra): Promise<CallToolResult> => {
      await logTool(
        server,
        context,
        extra.sessionId,
        "moonjoy_record_strategy_decision",
      );
      return runTool(() => recordStrategyDecision(context, args));
    },
  );

  server.registerTool(
    "moonjoy_get_market_quote",
    {
      title: "Get Market Quote",
      description:
        "Fetch a live Uniswap quote from Base mainnet for the given token pair and amount. Returns output amount, routing, and price impact. This is a preview only — it does not execute a trade.",
      inputSchema: z.object({
        tokenIn: z.string().describe("Input token address on Base."),
        tokenOut: z.string().describe("Output token address on Base."),
        amount: z.string().describe("Amount in base units."),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async (args, extra): Promise<CallToolResult> => {
      await logTool(server, context, extra.sessionId, "moonjoy_get_market_quote");
      return jsonResult(await getMoonjoyMarketQuote(context, args));
    },
  );

  server.registerTool(
    "moonjoy_submit_trade",
    {
      title: "Submit Simulated Trade",
      description:
        "Execute a simulated trade fill using a live Uniswap quote from Base mainnet. The trade debits input token and credits output token at the quoted rate. No real swap is broadcast. Requires an active live match.",
      inputSchema: z.object({
        matchId: z.string().describe("Active match ID."),
        tokenIn: z.string().describe("Token address to sell."),
        tokenOut: z.string().describe("Token address to buy."),
        amountInBaseUnits: z.string().describe("Amount of tokenIn to sell in base units."),
      }),
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
      },
    },
    async (args, extra): Promise<CallToolResult> => {
      await logTool(server, context, extra.sessionId, "moonjoy_submit_trade");
      return runTool(() => submitMoonjoyTrade(context, args));
    },
  );

  server.registerTool(
    "moonjoy_discover_base_tokens",
    {
      title: "Discover Base Tokens",
      description:
        "Discover tradable tokens on Base mainnet using Dexscreener data. Returns filtered candidates with liquidity, volume, and transaction counts. These are discovery inputs — always verify with a Uniswap quote before trading.",
      inputSchema: z.object({
        query: z.string().optional().describe("Search query for token name or symbol."),
        minLiquidityUsd: z.number().optional().describe("Minimum liquidity in USD."),
        minVolume24hUsd: z.number().optional().describe("Minimum 24h volume in USD."),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async (args, extra): Promise<CallToolResult> => {
      await logTool(server, context, extra.sessionId, "moonjoy_discover_base_tokens");
      return jsonResult(await discoverMoonjoyTokens(context, args));
    },
  );

  server.registerTool(
    "moonjoy_get_token_risk_profile",
    {
      title: "Get Token Risk Profile",
      description:
        "Get token metadata, risk tier, Dexscreener pair summary, and Uniswap quote availability for a Base mainnet token.",
      inputSchema: z.object({
        tokenAddress: z.string().describe("Token contract address on Base."),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async (args, extra): Promise<CallToolResult> => {
      await logTool(server, context, extra.sessionId, "moonjoy_get_token_risk_profile");
      return jsonResult(await getMoonjoyTokenRiskProfile(context, args.tokenAddress));
    },
  );

  server.registerTool(
    "moonjoy_get_leaderboard",
    {
      title: "Get Match Leaderboard",
      description:
        "Get the current leaderboard for a match, ranked by net PnL percentage. Includes both agents with realized/unrealized PnL, penalties, and drawdown.",
      inputSchema: z.object({
        matchId: z.string().describe("Match ID."),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (args, extra): Promise<CallToolResult> => {
      await logTool(server, context, extra.sessionId, "moonjoy_get_leaderboard");
      return jsonResult(await getMoonjoyMatchLeaderboard(args.matchId));
    },
  );

  server.registerTool(
    "moonjoy_get_trade_history",
    {
      title: "Get Trade History",
      description:
        "Get the full trade history for a match, optionally filtered to one agent. Each trade includes tokens, amounts, routing, price impact, and the quote snapshot reference.",
      inputSchema: z.object({
        matchId: z.string().describe("Match ID."),
        agentId: z.string().optional().describe("Optional agent ID to filter trades."),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (args, extra): Promise<CallToolResult> => {
      await logTool(server, context, extra.sessionId, "moonjoy_get_trade_history");
      return jsonResult(await getMoonjoyTradeHistory(args.matchId, args.agentId));
    },
  );

  server.registerTool(
    "moonjoy_get_allowed_tokens",
    {
      title: "Get Allowed Tokens",
      description:
        "List all tokens allowed for trading in the current match. Includes address, symbol, decimals, and risk tier.",
      inputSchema: z.object({
        matchId: z.string().describe("Match ID."),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (args, extra): Promise<CallToolResult> => {
      await logTool(server, context, extra.sessionId, "moonjoy_get_allowed_tokens");
      return jsonResult(await getMoonjoyAllowedTokens(args.matchId));
    },
  );

  server.registerResource(
    "moonjoy-context",
    "moonjoy://context",
    {
      title: "Moonjoy Agent Context",
      description: "Current Moonjoy MCP operating context and constraints.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify(
            {
              instructions: serverInstructions,
              phase: "Phase 6: Base Mainnet Trading Game",
              agentId: context.agentId,
              subject: context.subject,
              scopes: context.scopes,
            },
            null,
            2,
          ),
        },
      ],
    }),
  );

  return server;
}

async function runTool(
  work: () => Promise<unknown>,
): Promise<CallToolResult> {
  try {
    return jsonResult(await work());
  } catch (err) {
    return toolFailure(err);
  }
}

function toolFailure(err: unknown): CallToolResult {
  const message =
    err instanceof AgentBootstrapError
      ? err.message
      : err instanceof Error
        ? err.message
        : "Moonjoy tool failed.";

  return {
    content: [
      {
        type: "text",
        text: message,
      },
    ],
    isError: true,
  };
}

async function logTool(
  server: McpServer,
  context: McpRuntimeContext,
  sessionId: string | undefined,
  toolName: string,
  failed = false,
): Promise<void> {
  await server.sendLoggingMessage(
    {
      level: failed ? "warning" : "info",
      data: `${toolName} called by ${context.clientName}`,
    },
    sessionId,
  );

  await recordMcpEvent(
    context,
    failed ? "tool.failed" : "tool.called",
    { toolName, clientName: context.clientName },
  );
}

function jsonResult(value: unknown): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2),
      },
    ],
    structuredContent:
      value && typeof value === "object"
        ? ({ ...(value as Record<string, unknown>) } as Record<string, unknown>)
        : { value },
  };
}
