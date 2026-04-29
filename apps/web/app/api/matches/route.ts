import { NextResponse } from "next/server";
import {
  createChallengeForUser,
  getActiveMatchSnapshotForUser,
  MatchServiceError,
} from "@/lib/services/match-service";
import { matchErrorResponse, requirePrivyUserId } from "./_shared";

type CreateMatchBody = {
  invitedUserId?: string | null;
};

export async function GET(request: Request) {
  try {
    const privyUserId = await requirePrivyUserId(request);
    const snapshot = await getActiveMatchSnapshotForUser(privyUserId);
    return NextResponse.json(snapshot);
  } catch (error) {
    return matchErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const privyUserId = await requirePrivyUserId(request);
    const body = await readOptionalJsonBody<CreateMatchBody>(request);
    const match = await createChallengeForUser(privyUserId, {
      invitedUserId: body.invitedUserId ?? null,
    });
    return NextResponse.json(match, { status: 201 });
  } catch (error) {
    return matchErrorResponse(error);
  }
}

async function readOptionalJsonBody<T>(request: Request): Promise<T> {
  const text = await request.text();
  if (!text.trim()) {
    return {} as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new MatchServiceError("Invalid JSON body.", 400);
  }
}
