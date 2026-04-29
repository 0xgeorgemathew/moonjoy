import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  McpAuthError,
  approveMcpClientForUser,
  requirePhaseThreeReadyUser,
  tryProvisionExecutionAuthorizationForUser,
} from "@/lib/services/mcp-auth-service";

const AUTH_CODE_TTL_MS = 10 * 60 * 1000;
const ACCESS_TOKEN_TTL_SECONDS = 365 * 24 * 60 * 60;

export type OAuthAuthorizeParams = {
  response_type: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method?: string;
  state?: string;
  scope?: string;
  resource?: string;
};

export type OAuthApproveRequest = OAuthAuthorizeParams & {
  executionAuthorization?: {
    executionSignerId: string;
    executionWalletId: string;
    executionKeyCiphertext: string;
    executionKeyExpiresAt: string;
  };
};

export type OAuthClientMetadata = {
  client_name?: string;
  redirect_uris?: string[];
  token_endpoint_auth_method?: string;
  grant_types?: string[];
  response_types?: string[];
  scope?: string;
};

export function oauthMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["moonjoy:read", "moonjoy:agent"],
  };
}

export function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    scopes_supported: ["moonjoy:read", "moonjoy:agent"],
    bearer_methods_supported: ["header"],
    resource_name: "Moonjoy Local MCP",
  };
}

export async function registerOAuthClient(
  metadata: OAuthClientMetadata,
): Promise<Record<string, unknown>> {
  const redirectUris = metadata.redirect_uris?.filter(Boolean) ?? [];
  if (redirectUris.length === 0) {
    throw new McpAuthError("redirect_uris is required", 400);
  }

  const clientId = `moonjoy_client_${randomUUID()}`;
  const clientName = metadata.client_name?.trim().slice(0, 120) || "MCP Client";
  const client = {
    client_id: clientId,
    client_name: clientName,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code"],
    response_types: ["code"],
    scope: metadata.scope ?? "moonjoy:read moonjoy:agent",
    raw_metadata: metadata,
  };

  const { error } = await createAdminClient()
    .from("mcp_oauth_clients")
    .insert(client);

  if (error) {
    throw new McpAuthError("Failed to register OAuth client", 500);
  }

  return {
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: clientName,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code"],
    response_types: ["code"],
    scope: client.scope,
  };
}

export async function validateAuthorizeParams(
  params: OAuthAuthorizeParams,
): Promise<{ clientName: string }> {
  if (params.response_type !== "code") {
    throw new McpAuthError("Only authorization code flow is supported", 400);
  }
  if (!params.client_id || !params.redirect_uri || !params.code_challenge) {
    throw new McpAuthError("Missing OAuth authorization parameters", 400);
  }
  if ((params.code_challenge_method ?? "S256") !== "S256") {
    throw new McpAuthError("Only S256 PKCE is supported", 400);
  }

  const { data: client } = await createAdminClient()
    .from("mcp_oauth_clients")
    .select("client_name, redirect_uris")
    .eq("client_id", params.client_id)
    .maybeSingle();

  if (!client) {
    throw new McpAuthError("Unknown OAuth client", 400);
  }

  const redirectUris = client.redirect_uris as string[];
  if (!redirectUris.includes(params.redirect_uri)) {
    throw new McpAuthError("Unregistered redirect_uri", 400);
  }

  return { clientName: client.client_name as string };
}

export async function approveOAuthAuthorization(
  privyUserId: string,
  accessToken: string,
  params: OAuthApproveRequest,
): Promise<string> {
  await validateAuthorizeParams(params);
  const record = await requirePhaseThreeReadyUser(privyUserId);
  const executionAuthorization =
    params.executionAuthorization ??
    (await tryProvisionExecutionAuthorizationForUser(privyUserId, accessToken));

  const code = `mj_code_${randomBytes(32).toString("base64url")}`;
  const { error } = await createAdminClient()
    .from("mcp_oauth_authorization_codes")
    .insert({
      code,
      client_id: params.client_id,
      user_id: record.user.id,
      agent_id: record.agent.id,
      redirect_uri: params.redirect_uri,
      code_challenge: params.code_challenge,
      code_challenge_method: params.code_challenge_method ?? "S256",
      scope: params.scope ?? "moonjoy:read moonjoy:agent",
      resource: params.resource ?? null,
      execution_signer_id: executionAuthorization?.executionSignerId ?? null,
      execution_wallet_id: executionAuthorization?.executionWalletId ?? null,
      execution_key_ciphertext:
        executionAuthorization?.executionKeyCiphertext ?? null,
      execution_key_expires_at:
        executionAuthorization?.executionKeyExpiresAt ?? null,
      expires_at: new Date(Date.now() + AUTH_CODE_TTL_MS).toISOString(),
    });

  if (error) {
    throw new McpAuthError("Failed to create OAuth authorization code", 500);
  }

  const redirectUrl = new URL(params.redirect_uri);
  redirectUrl.searchParams.set("code", code);
  if (params.state) redirectUrl.searchParams.set("state", params.state);
  return redirectUrl.toString();
}

export async function exchangeAuthorizationCode(form: URLSearchParams) {
  if (form.get("grant_type") !== "authorization_code") {
    throw new McpAuthError("Unsupported grant_type", 400);
  }

  const code = form.get("code");
  const clientId = form.get("client_id");
  const redirectUri = form.get("redirect_uri");
  const codeVerifier = form.get("code_verifier");

  if (!code || !clientId || !redirectUri || !codeVerifier) {
    throw new McpAuthError("Missing OAuth token parameters", 400);
  }

  const supabase = createAdminClient();
  const { data: codeRow } = await supabase
    .from("mcp_oauth_authorization_codes")
    .select(
      "code, client_id, user_id, agent_id, redirect_uri, code_challenge, expires_at, consumed_at, scope, execution_signer_id, execution_wallet_id, execution_key_ciphertext, execution_key_expires_at",
    )
    .eq("code", code)
    .maybeSingle();

  if (!codeRow) {
    throw new McpAuthError("Invalid authorization code", 400);
  }

  const row = codeRow as {
    code: string;
    client_id: string;
    user_id: string;
    agent_id: string;
    redirect_uri: string;
    code_challenge: string;
    expires_at: string;
    consumed_at: string | null;
    scope: string | null;
    execution_signer_id: string | null;
    execution_wallet_id: string | null;
    execution_key_ciphertext: string | null;
    execution_key_expires_at: string | null;
  };

  if (
    row.client_id !== clientId ||
    row.redirect_uri !== redirectUri ||
    row.consumed_at ||
    new Date(row.expires_at).getTime() < Date.now() ||
    pkceS256(codeVerifier) !== row.code_challenge
  ) {
    throw new McpAuthError("Invalid authorization code grant", 400);
  }

  const { data: user } = await supabase
    .from("users")
    .select("privy_user_id")
    .eq("id", row.user_id)
    .single();

  if (!user?.privy_user_id) {
    throw new McpAuthError("Authorized user is missing", 400);
  }

  await supabase
    .from("mcp_oauth_authorization_codes")
    .update({
      consumed_at: new Date().toISOString(),
      execution_signer_id: null,
      execution_wallet_id: null,
      execution_key_ciphertext: null,
      execution_key_expires_at: null,
    })
    .eq("code", code);

  const { data: client } = await supabase
    .from("mcp_oauth_clients")
    .select("client_name")
    .eq("client_id", clientId)
    .single();

  const approval = await approveMcpClientForUser(
    user.privy_user_id,
    (client?.client_name as string | undefined) ?? "MCP Client",
    row.execution_signer_id &&
      row.execution_wallet_id &&
      row.execution_key_ciphertext &&
      row.execution_key_expires_at
      ? {
          executionSignerId: row.execution_signer_id,
          executionWalletId: row.execution_wallet_id,
          executionKeyCiphertext: row.execution_key_ciphertext,
          executionKeyExpiresAt: row.execution_key_expires_at,
        }
      : undefined,
  );

  if (!approval.token) {
    throw new McpAuthError("Failed to issue access token", 500);
  }

  return {
    access_token: approval.token,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    scope: row.scope ?? "moonjoy:read moonjoy:agent",
  };
}

function pkceS256(verifier: string): string {
  return createHash("sha256")
    .update(verifier)
    .digest("base64url");
}
