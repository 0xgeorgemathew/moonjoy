import { NextResponse } from "next/server";
import {
  getActiveMatchSnapshotForUser,
} from "@/lib/services/match-service";
import {
  createInvite,
  type CreateInviteInput,
  InviteServiceError,
} from "@/lib/services/invite-service";
import { matchErrorResponse, readJsonBody, requirePrivyUserId } from "./_shared";

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
    const body = await readJsonBody<CreateInviteInput>(request);
    const invite = await createInvite(privyUserId, {
      scopeType: body.scopeType,
      scopedEnsName: body.scopedEnsName,
      wagerUsd: body.wagerUsd,
      durationSeconds: body.durationSeconds,
      startingCapitalUsd: body.startingCapitalUsd,
      warmupSeconds: body.warmupSeconds,
    });

    return NextResponse.json(invite, { status: 201 });
  } catch (error) {
    if (error instanceof InviteServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }

    return matchErrorResponse(error);
  }
}
