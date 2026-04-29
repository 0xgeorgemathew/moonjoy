import { NextResponse } from "next/server";
import { AuthError, getAuthenticatedUserId } from "@/lib/auth/server";
import { MatchServiceError } from "@/lib/services/match-service";

export async function requirePrivyUserId(request: Request): Promise<string> {
  try {
    return await getAuthenticatedUserId(request);
  } catch (error) {
    if (error instanceof AuthError) {
      throw new MatchServiceError(error.message, error.statusCode);
    }

    throw new MatchServiceError("Unauthorized.", 401);
  }
}

export function matchErrorResponse(error: unknown): Response {
  if (error instanceof MatchServiceError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.statusCode },
    );
  }

  console.error("[match-api] Unexpected error", error);
  return NextResponse.json(
    { error: "Internal server error." },
    { status: 500 },
  );
}

export async function readJsonBody<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new MatchServiceError("Invalid JSON body.", 400);
  }
}
