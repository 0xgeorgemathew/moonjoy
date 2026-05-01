import { NextResponse } from "next/server";
import { AuthError, getAuthenticatedUserId } from "@/lib/auth/server";
import { createInvite, revokeInvite, type CreateInviteInput, InviteServiceError } from "@/lib/services/invite-service";

async function requirePrivyUserId(request: Request): Promise<string> {
  try {
    return await getAuthenticatedUserId(request);
  } catch (error) {
    if (error instanceof AuthError) {
      throw new InviteServiceError(error.message, error.statusCode);
    }
    throw new InviteServiceError("Unauthorized.", 401);
  }
}

function inviteErrorResponse(error: unknown): Response {
  if (error instanceof InviteServiceError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode });
  }
  console.error("[invite-api] Unexpected error", error);
  return NextResponse.json({ error: "Internal server error." }, { status: 500 });
}

export async function POST(request: Request) {
  try {
    const privyUserId = await requirePrivyUserId(request);
    const body = (await request.json()) as Partial<CreateInviteInput>;

    if (!body.scopeType || !["open", "ens"].includes(body.scopeType)) {
      return NextResponse.json(
        { error: "scopeType must be 'open' or 'ens'" },
        { status: 400 },
      );
    }

    const invite = await createInvite(privyUserId, {
      scopeType: body.scopeType,
      scopedEnsName: body.scopedEnsName,
      wagerUsd: body.wagerUsd,
      durationSeconds: body.durationSeconds,
      warmupSeconds: body.warmupSeconds,
    });
    return NextResponse.json(invite, { status: 201 });
  } catch (error) {
    return inviteErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const privyUserId = await requirePrivyUserId(request);
    const body = (await request.json()) as { inviteId?: string };

    if (!body.inviteId) {
      return NextResponse.json({ error: "inviteId is required" }, { status: 400 });
    }

    await revokeInvite(privyUserId, body.inviteId);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    return inviteErrorResponse(error);
  }
}
