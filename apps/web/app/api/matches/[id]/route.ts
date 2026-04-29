import { NextResponse } from "next/server";
import {
  cancelChallengeForUser,
  getMatchByIdForUser,
} from "@/lib/services/match-service";
import { matchErrorResponse, requirePrivyUserId } from "../_shared";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const privyUserId = await requirePrivyUserId(request);
    const { id } = await context.params;
    const match = await getMatchByIdForUser(privyUserId, id);
    return NextResponse.json(match);
  } catch (error) {
    return matchErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const privyUserId = await requirePrivyUserId(request);
    const { id } = await context.params;
    const match = await cancelChallengeForUser(privyUserId, id);
    return NextResponse.json(match);
  } catch (error) {
    return matchErrorResponse(error);
  }
}
