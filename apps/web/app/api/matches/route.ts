import { NextResponse } from "next/server";
import {
  getActiveMatchSnapshotForUser,
  MatchServiceError,
} from "@/lib/services/match-service";
import { matchErrorResponse, requirePrivyUserId } from "./_shared";

export async function GET(request: Request) {
  try {
    const privyUserId = await requirePrivyUserId(request);
    const snapshot = await getActiveMatchSnapshotForUser(privyUserId);
    return NextResponse.json(snapshot);
  } catch (error) {
    return matchErrorResponse(error);
  }
}

export async function POST() {
  return NextResponse.json(
    { error: "Challenge creation is retired. Use invite links instead." },
    { status: 410 },
  );
}
