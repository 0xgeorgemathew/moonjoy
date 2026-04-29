import { NextResponse } from "next/server";
import { appendPlanningMessage, ArenaServiceError } from "@/lib/services/arena-service";
import { AuthError, getAuthenticatedUserId } from "@/lib/auth/server";

type StrategyRequestBody = {
  role?: "user" | "agent" | "system";
  content?: string;
  matchId?: string;
  strategyId?: string;
  metadata?: Record<string, unknown>;
};

export async function POST(request: Request) {
  let privyUserId: string;
  try {
    privyUserId = await getAuthenticatedUserId(request);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: StrategyRequestBody;
  try {
    body = (await request.json()) as StrategyRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.content || typeof body.content !== "string") {
    return NextResponse.json(
      { error: "content is required and must be a string." },
      { status: 400 },
    );
  }

  if (!body.role || !["user", "agent", "system"].includes(body.role)) {
    return NextResponse.json(
      { error: "role must be one of: user, agent, system." },
      { status: 400 },
    );
  }

  try {
    const message = await appendPlanningMessage(privyUserId, {
      role: body.role,
      content: body.content,
      matchId: body.matchId,
      strategyId: body.strategyId,
      metadata: body.metadata,
    });
    return NextResponse.json(message, { status: 201 });
  } catch (error) {
    if (error instanceof ArenaServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("[arena/strategy] Unexpected error", error);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
