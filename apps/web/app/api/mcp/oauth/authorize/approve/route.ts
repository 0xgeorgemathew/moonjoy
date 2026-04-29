import { NextResponse } from "next/server";
import { AuthError, getAuthenticatedUserId } from "@/lib/auth/server";
import { McpAuthError } from "@/lib/services/mcp-auth-service";
import {
  approveOAuthAuthorization,
  type OAuthApproveRequest,
} from "@/lib/services/mcp-oauth-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      throw new AuthError("Missing authorization header", 401);
    }

    const accessToken = authHeader.slice("Bearer ".length).trim();
    const privyUserId = await getAuthenticatedUserId(request);
    const params = (await request.json()) as OAuthApproveRequest;
    const redirectUrl = await approveOAuthAuthorization(
      privyUserId,
      accessToken,
      params,
    );
    return NextResponse.json({ redirectUrl });
  } catch (err) {
    const status =
      err instanceof AuthError || err instanceof McpAuthError
        ? err.statusCode
        : 500;
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to approve OAuth authorization",
      },
      { status },
    );
  }
}
