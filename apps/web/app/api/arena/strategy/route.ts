import { NextResponse } from "next/server";
import { appendPlanningMessage, ArenaServiceError } from "@/lib/services/arena-service";
import { AuthError, getAuthenticatedUserId } from "@/lib/auth/server";

type ActionRequest =
  | { action: "append_message"; role: "user" | "agent" | "system"; content: string; matchId?: string; strategyId?: string; metadata?: Record<string, unknown> }
  | { action: "create_draft"; name: string; sourceType: string; manifestBody: Record<string, unknown>; matchId?: string }
  | { action: "update_draft"; strategyId: string; name?: string; manifestBody?: Record<string, unknown>; status?: string }
  | { action: "record_decision"; strategyId: string; rationale: string; matchId?: string; tradeId?: string };

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

  let body: ActionRequest;
  try {
    body = (await request.json()) as ActionRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.action || typeof body.action !== "string") {
    return NextResponse.json({ error: "action is required." }, { status: 400 });
  }

  try {
    switch (body.action) {
      case "append_message": {
        if (!body.content || typeof body.content !== "string") {
          return NextResponse.json({ error: "content is required." }, { status: 400 });
        }
        if (!body.role || !["user", "agent", "system"].includes(body.role)) {
          return NextResponse.json({ error: "role must be one of: user, agent, system." }, { status: 400 });
        }
        const message = await appendPlanningMessage(privyUserId, {
          role: body.role,
          content: body.content,
          matchId: body.matchId,
          strategyId: body.strategyId,
          metadata: body.metadata,
        });
        return NextResponse.json(message, { status: 201 });
      }

      case "create_draft": {
        if (!body.name || typeof body.name !== "string") {
          return NextResponse.json({ error: "name is required." }, { status: 400 });
        }
        const message = await appendPlanningMessage(privyUserId, {
          role: "system",
          content: `Strategy draft created: ${body.name}`,
          matchId: body.matchId,
          metadata: {
            type: "strategy_draft_created",
            name: body.name,
            sourceType: body.sourceType,
            manifestBody: body.manifestBody,
          },
        });
        return NextResponse.json(message, { status: 201 });
      }

      case "update_draft": {
        if (!body.strategyId || typeof body.strategyId !== "string") {
          return NextResponse.json({ error: "strategyId is required." }, { status: 400 });
        }
        const message = await appendPlanningMessage(privyUserId, {
          role: "system",
          content: `Strategy draft updated${body.status ? ` → ${body.status}` : ""}`,
          metadata: {
            type: "strategy_draft_updated",
            strategyId: body.strategyId,
            name: body.name,
            manifestBody: body.manifestBody,
            status: body.status,
          },
        });
        return NextResponse.json(message, { status: 201 });
      }

      case "record_decision": {
        if (!body.strategyId || typeof body.strategyId !== "string") {
          return NextResponse.json({ error: "strategyId is required." }, { status: 400 });
        }
        if (!body.rationale || typeof body.rationale !== "string") {
          return NextResponse.json({ error: "rationale is required." }, { status: 400 });
        }
        const message = await appendPlanningMessage(privyUserId, {
          role: "agent",
          content: body.rationale,
          matchId: body.matchId,
          strategyId: body.strategyId,
          metadata: {
            type: "strategy_decision",
            tradeId: body.tradeId,
          },
        });
        return NextResponse.json(message, { status: 201 });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${(body as { action: string }).action}` },
          { status: 400 },
        );
    }
  } catch (error) {
    if (error instanceof ArenaServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("[arena/strategy] Unexpected error", error);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
