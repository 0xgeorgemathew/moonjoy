import { protectedResourceMetadata } from "@/lib/services/mcp-oauth-service";
import { getRequestOrigin } from "@/lib/services/request-origin-service";

export const runtime = "nodejs";

export function GET(request: Request) {
  return Response.json(protectedResourceMetadata(getRequestOrigin(request)));
}
