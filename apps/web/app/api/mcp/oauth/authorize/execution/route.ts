import { NextResponse } from "next/server";
import { AuthError, getAuthenticatedUserId } from "@/lib/auth/server";
import {
  McpAuthError,
  prepareExecutionAuthorizationForUser,
} from "@/lib/services/mcp-auth-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      throw new AuthError("Missing authorization header", 401);
    }

    const privyUserId = await getAuthenticatedUserId(request);
    const execution = await prepareExecutionAuthorizationForUser(privyUserId);
    return NextResponse.json(execution);
  } catch (error) {
    const status =
      error instanceof AuthError || error instanceof McpAuthError
        ? error.statusCode
        : 500;

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to prepare execution authorization",
      },
      { status },
    );
  }
}
