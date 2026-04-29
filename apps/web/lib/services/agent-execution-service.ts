import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import {
  generateP256KeyPair,
  type LinkedAccount,
  type PrivyClient,
  type Wallet,
} from "@privy-io/node";
import { getPrivyServerClient } from "@/lib/auth/privy-server";
import { createAdminClient } from "@/lib/supabase/admin";

const EXECUTION_KEY_ALGORITHM = "aes-256-gcm";

export class AgentExecutionError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
  }
}

export type ProvisionedExecutionAuthorization = {
  executionSignerId: string;
  executionWalletId: string;
  executionKeyCiphertext: string;
  executionKeyExpiresAt: string;
};

export type PreparedExecutionAuthorization = ProvisionedExecutionAuthorization & {
  executionWalletAddress: string;
};

export type LoadedExecutionAuthorization = {
  executionSignerId: string;
  executionWalletId: string;
  executionKeyExpiresAt: string;
  authorizationContext: {
    authorization_private_keys: string[];
  };
};

export async function provisionPrivyExecutionAuthorization(params: {
  accessToken: string;
  smartAccountAddress: string;
}): Promise<ProvisionedExecutionAuthorization> {
  const privyClient = getPrivyServerClient();
  let walletAuthResponse: Awaited<ReturnType<typeof authenticateWalletsWithJwt>>;
  try {
    walletAuthResponse = await authenticateWalletsWithJwt(
      privyClient,
      params.accessToken,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Privy wallet authentication failed.";
    if (
      message.includes("Invalid JWT token provided") ||
      message.toLowerCase().includes("invalid jwt")
    ) {
      throw new AgentExecutionError(
        "Privy rejected the token used for wallet execution authorization.",
        409,
      );
    }

    throw error;
  }

  if (!walletAuthResponse.authorization_key) {
    throw new AgentExecutionError(
      "Privy did not return a reusable execution authorization key.",
      502,
    );
  }

  const matchingWallet = walletAuthResponse.wallets.find(
    (wallet) =>
      wallet.chain_type === "ethereum" &&
      wallet.address.toLowerCase() === params.smartAccountAddress.toLowerCase(),
  );

  if (!matchingWallet) {
    throw new AgentExecutionError(
      "Privy did not return the agent smart wallet for execution authorization.",
      409,
    );
  }

  return {
    executionSignerId: buildExecutionSignerId(walletAuthResponse.authorization_key),
    executionWalletId: matchingWallet.id,
    executionKeyCiphertext: sealExecutionKey(walletAuthResponse.authorization_key),
    executionKeyExpiresAt: normalizePrivyExpiry(walletAuthResponse.expires_at),
  };
}

export async function loadExecutionAuthorization(
  approvalId: string,
): Promise<LoadedExecutionAuthorization | null> {
  const { data } = await createAdminClient()
    .from("mcp_approvals")
    .select(
      "execution_signer_id, execution_wallet_id, execution_key_ciphertext, execution_key_expires_at",
    )
    .eq("id", approvalId)
    .maybeSingle();

  if (
    !data?.execution_signer_id ||
    !data.execution_wallet_id ||
    !data.execution_key_ciphertext ||
    !data.execution_key_expires_at
  ) {
    return null;
  }

  if (new Date(data.execution_key_expires_at).getTime() <= Date.now()) {
    return null;
  }

  return {
    executionSignerId: data.execution_signer_id,
    executionWalletId: data.execution_wallet_id,
    executionKeyExpiresAt: data.execution_key_expires_at,
    authorizationContext: {
      authorization_private_keys: [
        unsealExecutionKey(data.execution_key_ciphertext),
      ],
    },
  };
}

export async function resolvePrivyWalletIdForAddress(params: {
  privyUserId: string;
  walletAddress: string;
}): Promise<string> {
  const walletsPage = await getPrivyServerClient().wallets().list({
    user_id: params.privyUserId,
    chain_type: "ethereum",
  });
  const wallet = walletsPage.data.find(
    (candidate) =>
      candidate.address.toLowerCase() === params.walletAddress.toLowerCase(),
  );

  if (!wallet?.id) {
    throw new AgentExecutionError(
      `Privy did not return a wallet for address ${params.walletAddress}.`,
      409,
    );
  }

  return wallet.id;
}

export async function prepareSessionSignerExecutionAuthorization(params: {
  privyUserId: string;
  embeddedSignerAddress: string;
}): Promise<PreparedExecutionAuthorization> {
  const { privateKey, publicKey } = await generateP256KeyPair();
  const keyQuorum = await getPrivyServerClient().keyQuorums().create({
    authorization_threshold: 1,
    display_name: `Moonjoy embedded wallet signer ${params.embeddedSignerAddress.slice(0, 10)}`,
    public_keys: [publicKey],
  });

  const executionWalletId = await resolvePrivyEmbeddedWalletIdForAddress({
    privyUserId: params.privyUserId,
    walletAddress: params.embeddedSignerAddress,
  });

  return {
    executionSignerId: keyQuorum.id,
    executionWalletId,
    executionWalletAddress: params.embeddedSignerAddress,
    executionKeyCiphertext: sealExecutionKey(privateKey),
    executionKeyExpiresAt: "9999-12-31T23:59:59.000Z",
  };
}

async function resolvePrivyEmbeddedWalletIdForAddress(params: {
  privyUserId: string;
  walletAddress: string;
}): Promise<string> {
  const privyUser = await getPrivyServerClient().users()._get(params.privyUserId);
  const normalizedAddress = params.walletAddress.toLowerCase();
  const wallet = privyUser.linked_accounts.find(
    (account): account is LinkedAccount & { address: string; id: string } =>
      account.type === "wallet" &&
      "wallet_client_type" in account &&
      (account as { wallet_client_type?: string }).wallet_client_type === "privy" &&
      "chain_type" in account &&
      (account as { chain_type?: string }).chain_type === "ethereum" &&
      "address" in account &&
      typeof (account as { address?: unknown }).address === "string" &&
      "id" in account &&
      typeof (account as { id?: unknown }).id === "string" &&
      account.address.toLowerCase() === normalizedAddress,
  );

  if (!wallet?.id) {
    throw new AgentExecutionError(
      `Privy did not return the embedded wallet for address ${params.walletAddress}.`,
      409,
    );
  }

  return wallet.id;
}

function buildExecutionSignerId(rawAuthorizationKey: string): string {
  const digest = createHash("sha256")
    .update(rawAuthorizationKey)
    .digest("hex");
  return `privy_auth_${digest.slice(0, 24)}`;
}

function sealExecutionKey(rawAuthorizationKey: string): string {
  const key = getExecutionEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(EXECUTION_KEY_ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(rawAuthorizationKey, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return JSON.stringify({
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  });
}

function unsealExecutionKey(sealedValue: string): string {
  const parsed = JSON.parse(sealedValue) as {
    iv?: string;
    tag?: string;
    ciphertext?: string;
  };

  if (!parsed.iv || !parsed.tag || !parsed.ciphertext) {
    throw new AgentExecutionError("Stored execution authorization is invalid.", 500);
  }

  const decipher = createDecipheriv(
    EXECUTION_KEY_ALGORITHM,
    getExecutionEncryptionKey(),
    Buffer.from(parsed.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(parsed.ciphertext, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

function getExecutionEncryptionKey(): Buffer {
  const secret =
    process.env.MOONJOY_EXECUTION_KEY_SECRET ?? process.env.PRIVY_APP_SECRET;

  if (!secret) {
    throw new AgentExecutionError(
      "Missing execution-key encryption secret.",
      500,
    );
  }

  return createHash("sha256").update(secret).digest();
}

function normalizePrivyExpiry(epochSeconds: number): string {
  const millis =
    epochSeconds > 1_000_000_000_000 ? epochSeconds : epochSeconds * 1000;
  return new Date(millis).toISOString();
}

async function authenticateWalletsWithJwt(
  privyClient: PrivyClient,
  accessToken: string,
): Promise<{
  authorization_key?: string;
  expires_at: number;
  wallets: Wallet[];
}> {
  // The published docs allow a JWT-only authenticate call even though the
  // generated SDK types currently require HPKE parameters.
  const response = await (
    privyClient.wallets().authenticateWithJwt as unknown as (body: {
      user_jwt: string;
    }) => Promise<{
      authorization_key?: string;
      expires_at: number;
      wallets: Wallet[];
    }>
  )({
    user_jwt: accessToken,
  });

  return response;
}
