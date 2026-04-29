import { McpAuthError } from "@/lib/services/mcp-auth-service";
import {
  registerOAuthClient,
  type OAuthClientMetadata,
} from "@/lib/services/mcp-oauth-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const metadata = (await request.json()) as OAuthClientMetadata;
    return Response.json(await registerOAuthClient(metadata), {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return oauthError(err);
  }
}

function oauthError(err: unknown): Response {
  const status = err instanceof McpAuthError ? err.statusCode : 500;
  return Response.json(
    {
      error: status === 500 ? "server_error" : "invalid_request",
      error_description:
        err instanceof Error ? err.message : "OAuth registration failed",
    },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
