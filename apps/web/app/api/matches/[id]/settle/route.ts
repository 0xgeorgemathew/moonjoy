import { NextResponse } from "next/server";
import { settleMatchForUser } from "@/lib/services/match-service";
import {
  matchErrorResponse,
  readJsonBody,
  requirePrivyUserId,
} from "../../_shared";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type SettleBody = {
  creatorStartingValueUsd: number;
  creatorCurrentValueUsd: number;
  opponentStartingValueUsd: number;
  opponentCurrentValueUsd: number;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const privyUserId = await requirePrivyUserId(request);
    const { id } = await context.params;
    const body = await readJsonBody<SettleBody>(request);
    const match = await settleMatchForUser(privyUserId, id, body);
    return NextResponse.json(match);
  } catch (error) {
    return matchErrorResponse(error);
  }
}
