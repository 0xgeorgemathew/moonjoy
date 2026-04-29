import { McpAuthError } from "@/lib/services/mcp-auth-service";
import { exchangeAuthorizationCode } from "@/lib/services/mcp-oauth-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const params = new URLSearchParams();
    for (const [key, value] of form.entries()) {
      if (typeof value === "string") params.set(key, value);
    }

    return Response.json(await exchangeAuthorizationCode(params), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    const status = err instanceof McpAuthError ? err.statusCode : 500;
    return Response.json(
      {
        error: status === 500 ? "server_error" : "invalid_grant",
        error_description:
          err instanceof Error ? err.message : "OAuth token exchange failed",
      },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
