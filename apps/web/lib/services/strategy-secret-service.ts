import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { sortObjectKeys } from "@/lib/services/agent-bootstrap-utils";

const SECRET_KEY = process.env.MOONJOY_SECRET_SAUCE_KEY ?? "";
const ALGORITHM = "aes-256-gcm";

type EncryptedEnvelope = {
  kind: "moonjoy_secret_sauce";
  version: 1;
  algorithm: "aes-256-gcm";
  keyId: string;
  iv: string;
  authTag: string;
  ciphertext: string;
};

function requireSecretKey(): Buffer {
  if (!SECRET_KEY) {
    throw new Error(
      "Secret sauce encryption is not configured. Set MOONJOY_SECRET_SAUCE_KEY to a 32-byte secret.",
    );
  }

  const trimmed = SECRET_KEY.trim();
  const directBytes = Buffer.from(trimmed, "utf8");
  if (directBytes.length === 32) {
    return directBytes;
  }

  const hex = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
  if (/^[0-9a-fA-F]{64}$/.test(hex)) {
    return Buffer.from(hex, "hex");
  }

  const base64Bytes = Buffer.from(trimmed, "base64");
  if (base64Bytes.length === 32) {
    return base64Bytes;
  }

  throw new Error(
    "MOONJOY_SECRET_SAUCE_KEY must be 32 UTF-8 bytes, 64 hex chars, or base64 for 32 bytes.",
  );
}

function getKeyId(key: Buffer): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

export function buildSecretManifestPreview(
  manifestBody: Record<string, unknown>,
): Record<string, unknown> {
  return {
    encrypted: true,
    visibility: "mcp_only",
    version: typeof manifestBody.version === "number" ? manifestBody.version : 1,
    mode: typeof manifestBody.mode === "string" ? manifestBody.mode : "secret_sauce",
    summary: "Secret sauce is encrypted at rest and readable only through Moonjoy MCP.",
  };
}

export function encryptSecretManifest(
  manifestBody: Record<string, unknown>,
): EncryptedEnvelope {
  const key = requireSecretKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const canonicalJson = JSON.stringify(sortObjectKeys(manifestBody));

  const ciphertext = Buffer.concat([
    cipher.update(canonicalJson, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    kind: "moonjoy_secret_sauce",
    version: 1,
    algorithm: "aes-256-gcm",
    keyId: getKeyId(key),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function decryptSecretManifest(
  envelope: Record<string, unknown>,
): Record<string, unknown> {
  if (
    envelope.kind !== "moonjoy_secret_sauce" ||
    envelope.version !== 1 ||
    envelope.algorithm !== "aes-256-gcm" ||
    typeof envelope.iv !== "string" ||
    typeof envelope.authTag !== "string" ||
    typeof envelope.ciphertext !== "string"
  ) {
    throw new Error("Secret sauce payload is not a valid encrypted Moonjoy envelope.");
  }

  const key = requireSecretKey();
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(envelope.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");

  const parsed = JSON.parse(plaintext) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Secret sauce payload did not decrypt to a manifest object.");
  }

  return parsed as Record<string, unknown>;
}
