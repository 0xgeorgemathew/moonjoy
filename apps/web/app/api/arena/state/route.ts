import { NextResponse } from "next/server";
import { getArenaSnapshot, ArenaServiceError } from "@/lib/services/arena-service";
import { AuthError, getAuthenticatedUserId } from "@/lib/auth/server";

export async function GET(request: Request) {
  let privyUserId: string;
  try {
    privyUserId = await getAuthenticatedUserId(request);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const snapshot = await getArenaSnapshot(privyUserId);
    return NextResponse.json(snapshot);
  } catch (error) {
    if (error instanceof ArenaServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("[arena/state] Unexpected error", error);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
