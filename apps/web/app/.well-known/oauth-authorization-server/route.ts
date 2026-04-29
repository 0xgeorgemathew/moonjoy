import { oauthMetadata } from "@/lib/services/mcp-oauth-service";
import { getRequestOrigin } from "@/lib/services/request-origin-service";

export const runtime = "nodejs";

export function GET(request: Request) {
  return Response.json(oauthMetadata(getRequestOrigin(request)));
}
