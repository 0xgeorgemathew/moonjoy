import { NextResponse } from "next/server";
import { AuthError, getAuthenticatedUserId } from "@/lib/auth/server";
import { joinInvite, InviteServiceError } from "@/lib/services/invite-service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token: inviteToken } = await params;
    let privyUserId: string;
    try {
      privyUserId = await getAuthenticatedUserId(request);
    } catch (error) {
      if (error instanceof AuthError) {
        return NextResponse.json({ error: error.message }, { status: error.statusCode });
      }
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const result = await joinInvite(privyUserId, inviteToken);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof InviteServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("[invite-join-api] Unexpected error", error);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
