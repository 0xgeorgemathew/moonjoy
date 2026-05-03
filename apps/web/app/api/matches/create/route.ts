import { NextResponse } from "next/server";
import { getMatchCreationContext, InviteServiceError } from "@/lib/services/invite-service";
import { matchErrorResponse, requirePrivyUserId } from "../_shared";

export async function GET(request: Request) {
  try {
    const privyUserId = await requirePrivyUserId(request);
    const context = await getMatchCreationContext(privyUserId);
    return NextResponse.json(context);
  } catch (error) {
    if (error instanceof InviteServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }

    return matchErrorResponse(error);
  }
}
