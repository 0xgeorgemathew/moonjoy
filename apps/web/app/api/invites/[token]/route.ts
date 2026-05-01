import { NextResponse } from "next/server";
import { getInviteByToken, InviteServiceError } from "@/lib/services/invite-service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token: inviteToken } = await params;
    const invite = await getInviteByToken(inviteToken);
    return NextResponse.json({
      id: invite.id,
      inviteToken: invite.invite_token,
      scopeType: invite.scope_type,
      scopedEnsName: invite.scoped_ens_name,
      wagerUsd: Number(invite.wager_usd),
      durationSeconds: Number(invite.duration_seconds),
      warmupSeconds: Number(invite.warmup_seconds),
      status: invite.status,
      createdAt: invite.created_at,
      expiresAt: invite.expires_at,
    });
  } catch (error) {
    if (error instanceof InviteServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }
}
