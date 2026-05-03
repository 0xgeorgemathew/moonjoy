import { NextResponse } from "next/server";
import { requirePrivyUserId, matchErrorResponse, readJsonBody } from "../../_shared";
import { submitSimulatedTrade } from "@/lib/services/trade-service";
import { getTradeHistoryForMatch } from "@/lib/services/trade-service";
import { getLeaderboardForMatch } from "@/lib/services/leaderboard-service";
import { createAdminClient } from "@/lib/supabase/admin";

type TradeRequestBody = {
  tokenIn: string;
  tokenOut: string;
  amountInBaseUnits: string;
  quoteSnapshotId?: string;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: matchId } = await params;
    const privyUserId = await requirePrivyUserId(request);
    const body = await readJsonBody<TradeRequestBody>(request);

    if (!body.tokenIn || !body.tokenOut || !body.amountInBaseUnits) {
      return NextResponse.json(
        { error: "tokenIn, tokenOut, and amountInBaseUnits are required." },
        { status: 400 },
      );
    }

    const supabase = createAdminClient();
    const { data: user } = await supabase
      .from("users")
      .select("id")
      .eq("privy_user_id", privyUserId)
      .single();

    if (!user) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    const { data: agent } = await supabase
      .from("agents")
      .select("id, smart_account_address")
      .eq("user_id", (user as { id: string }).id)
      .eq("status", "active")
      .maybeSingle();

    if (!agent?.smart_account_address) {
      return NextResponse.json({ error: "Active agent not found." }, { status: 404 });
    }

    const { data: match } = await supabase
      .from("matches")
      .select("creator_agent_id, opponent_agent_id")
      .eq("id", matchId)
      .single();

    if (!match) {
      return NextResponse.json({ error: "Match not found." }, { status: 404 });
    }

    const matchRow = match as Record<string, unknown>;
    const agentId = (agent as { id: string }).id;
    let seat: "creator" | "opponent";
    if (matchRow.creator_agent_id === agentId) {
      seat = "creator";
    } else if (matchRow.opponent_agent_id === agentId) {
      seat = "opponent";
    } else {
      return NextResponse.json({ error: "Not a participant." }, { status: 403 });
    }

    const result = await submitSimulatedTrade({
      matchId,
      agentId,
      smartAccountAddress: (agent as { smart_account_address: string }).smart_account_address,
      seat,
      tokenIn: body.tokenIn,
      tokenOut: body.tokenOut,
      amountInBaseUnits: body.amountInBaseUnits,
      quoteSnapshotId: body.quoteSnapshotId,
    });

    return NextResponse.json(result);
  } catch (error) {
    return matchErrorResponse(error);
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: matchId } = await params;
    await requirePrivyUserId(request);

    const [trades, leaderboard] = await Promise.all([
      getTradeHistoryForMatch(matchId),
      getLeaderboardForMatch(matchId),
    ]);

    return NextResponse.json({ trades, leaderboard });
  } catch (error) {
    return matchErrorResponse(error);
  }
}
