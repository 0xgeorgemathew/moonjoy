import { OAuthAuthorizePanel } from "@/components/oauth-authorize-panel";
import {
  validateAuthorizeParams,
  type OAuthAuthorizeParams,
} from "@/lib/services/mcp-oauth-service";

export const dynamic = "force-dynamic";

export default async function OAuthAuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = normalizeAuthorizeParams(await searchParams);
  let error: string | null = null;
  let clientName = "MCP Client";

  try {
    const validated = await validateAuthorizeParams(params);
    clientName = validated.clientName;
  } catch (err) {
    error = err instanceof Error ? err.message : "Invalid OAuth request";
  }

  return (
    <OAuthAuthorizePanel
      params={params}
      clientName={clientName}
      error={error}
    />
  );
}

function normalizeAuthorizeParams(
  input: Record<string, string | string[] | undefined>,
): OAuthAuthorizeParams {
  return {
    response_type: getOne(input.response_type),
    client_id: getOne(input.client_id),
    redirect_uri: getOne(input.redirect_uri),
    code_challenge: getOne(input.code_challenge),
    code_challenge_method: getOne(input.code_challenge_method) || "S256",
    state: getOne(input.state) || undefined,
    scope: getOne(input.scope) || undefined,
    resource: getOne(input.resource) || undefined,
  };
}

function getOne(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}
