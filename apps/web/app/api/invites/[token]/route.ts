import { NextResponse } from "next/server";
import { getInviteByToken, InviteServiceError } from "@/lib/services/invite-service";
import { createAdminClient } from "@/lib/supabase/admin";
import { getFullNameForAddress } from "@/lib/services/ens-service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token: inviteToken } = await params;
    const invite = await getInviteByToken(inviteToken);

    let creatorEnsName: string | null = null;
    const creatorAgentId = invite.creator_agent_id as string | null;
    if (creatorAgentId) {
      const supabase = createAdminClient();
      const { data: agent } = await supabase
        .from("agents")
        .select("smart_account_address")
        .eq("id", creatorAgentId)
        .single();
      if (agent?.smart_account_address) {
        creatorEnsName = await getFullNameForAddress(agent.smart_account_address as `0x${string}`);
      }
    }

    return NextResponse.json({
      id: invite.id,
      inviteToken: invite.invite_token,
      scopeType: invite.scope_type,
      scopedEnsName: invite.scoped_ens_name,
      wagerUsd: Number(invite.wager_usd),
      durationSeconds: Number(invite.duration_seconds),
      startingCapitalUsd: Number(invite.starting_capital_usd),
      warmupSeconds: Number(invite.warmup_seconds),
      status: invite.status,
      createdAt: invite.created_at,
      expiresAt: invite.expires_at,
      creatorEnsName,
    });
  } catch (error) {
    if (error instanceof InviteServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }
}
