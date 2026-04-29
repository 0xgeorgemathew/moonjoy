import { NextResponse } from "next/server";
import { getActiveMatchSnapshotForUser } from "@/lib/services/match-service";
import { matchErrorResponse, requirePrivyUserId } from "../_shared";

export async function GET(request: Request) {
  try {
    const privyUserId = await requirePrivyUserId(request);
    const snapshot = await getActiveMatchSnapshotForUser(privyUserId);
    return NextResponse.json(snapshot);
  } catch (error) {
    return matchErrorResponse(error);
  }
}
