import { NextResponse } from "next/server";
import { startLiveForUser } from "@/lib/services/match-service";
import { matchErrorResponse, requirePrivyUserId } from "../../_shared";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const privyUserId = await requirePrivyUserId(request);
    const { id } = await context.params;
    const match = await startLiveForUser(privyUserId, id);
    return NextResponse.json(match);
  } catch (error) {
    return matchErrorResponse(error);
  }
}
