import {
  createPublicClient,
  http,
  type Address,
  type Hash,
  type WalletClient,
} from "viem";
import { baseSepolia } from "viem/chains";
import {
  durinRegistrarAbi,
  durinRegistryAbi,
  DURIN_L2_REGISTRY_ADDRESS,
  DURIN_L2_REGISTRAR_ADDRESS,
} from "@moonjoy/contracts";
import { ALLOWED_USER_TEXT_RECORD_KEYS } from "@/lib/types/ens";

const RPC_URL = process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL;

function getTransport() {
  return http(RPC_URL);
}

export function getEnsPublicClient() {
  return createPublicClient({
    chain: baseSepolia,
    transport: getTransport(),
  });
}

async function resolveNode(label: string): Promise<`0x${string}`> {
  const client = getEnsPublicClient();
  const baseNode = (await client.readContract({
    address: DURIN_L2_REGISTRY_ADDRESS,
    abi: durinRegistryAbi,
    functionName: "baseNode",
  })) as `0x${string}`;
  return (await client.readContract({
    address: DURIN_L2_REGISTRY_ADDRESS,
    abi: durinRegistryAbi,
    functionName: "makeNode",
    args: [baseNode, label],
  })) as `0x${string}`;
}

export async function checkAvailability(label: string): Promise<boolean> {
  const client = getEnsPublicClient();
  const available = await client.readContract({
    address: DURIN_L2_REGISTRAR_ADDRESS,
    abi: durinRegistrarAbi,
    functionName: "available",
    args: [label],
  });
  return Boolean(available);
}

export async function registerName(
  label: string,
  ownerAddress: Address,
  walletClient: WalletClient,
): Promise<Hash> {
  if (!walletClient.account) {
    throw new Error("Wallet client has no account");
  }
  const hash = await walletClient.writeContract({
    address: DURIN_L2_REGISTRAR_ADDRESS,
    abi: durinRegistrarAbi,
    functionName: "register",
    args: [label, ownerAddress],
    chain: baseSepolia,
    account: walletClient.account,
  });
  return hash;
}

export async function resolveAddress(label: string): Promise<Address | null> {
  const node = await resolveNode(label);
  const client = getEnsPublicClient();
  const address = (await client.readContract({
    address: DURIN_L2_REGISTRY_ADDRESS,
    abi: durinRegistryAbi,
    functionName: "addr",
    args: [node],
  })) as Address;
  if (!address || address === "0x0000000000000000000000000000000000000000") {
    return null;
  }
  return address;
}

export async function setTextRecord(
  label: string,
  key: string,
  value: string,
  walletClient: WalletClient,
): Promise<Hash> {
  if (!walletClient.account) {
    throw new Error("Wallet client has no account");
  }
  const node = await resolveNode(label);
  const hash = await walletClient.writeContract({
    address: DURIN_L2_REGISTRY_ADDRESS,
    abi: durinRegistryAbi,
    functionName: "setText",
    args: [node, key, value],
    chain: baseSepolia,
    account: walletClient.account,
  });
  return hash;
}

export async function resolveTextRecord(
  label: string,
  key: string,
): Promise<string> {
  const node = await resolveNode(label);
  const client = getEnsPublicClient();
  return (await client.readContract({
    address: DURIN_L2_REGISTRY_ADDRESS,
    abi: durinRegistryAbi,
    functionName: "text",
    args: [node, key],
  })) as string;
}

export async function getPrimaryName(
  address: Address,
): Promise<string | null> {
  const client = getEnsPublicClient();
  try {
    const name = (await client.readContract({
      address: DURIN_L2_REGISTRAR_ADDRESS,
      abi: durinRegistrarAbi,
      functionName: "getName",
      args: [address],
    })) as string;
    return name || null;
  } catch {
    return null;
  }
}

export async function getFullNameForAddress(
  address: Address,
): Promise<string | null> {
  const client = getEnsPublicClient();
  try {
    const name = (await client.readContract({
      address: DURIN_L2_REGISTRAR_ADDRESS,
      abi: durinRegistrarAbi,
      functionName: "getFullName",
      args: [address],
    })) as string;
    return name ? toMoonjoyName(name) : null;
  } catch {
    const label = await getPrimaryName(address);
    return label ? toMoonjoyName(label) : null;
  }
}

export async function getNameNode(label: string): Promise<`0x${string}`> {
  return resolveNode(label);
}

const ENS_LABEL_REGEX = /^[a-z0-9]([a-z0-9-]{1,30}[a-z0-9])?$/;

function toMoonjoyName(nameOrLabel: string): string {
  const normalized = nameOrLabel.toLowerCase();
  return normalized.endsWith(".moonjoy.eth")
    ? normalized
    : `${normalized}.moonjoy.eth`;
}

export function validateEnsLabel(label: string): {
  valid: boolean;
  error?: string;
} {
  if (!label) return { valid: false, error: "Label is required" };
  if (label.length < 3)
    return { valid: false, error: "Label must be at least 3 characters" };
  if (label.length > 32)
    return { valid: false, error: "Label must be at most 32 characters" };
  if (!ENS_LABEL_REGEX.test(label))
    return {
      valid: false,
      error:
        "Label must be lowercase alphanumeric with optional hyphens (no leading/trailing hyphens)",
    };
  return { valid: true };
}

export function validateUserTextRecord(
  key: string,
  value: string,
): { valid: boolean; error?: string } {
  if (!key) return { valid: false, error: "Record key is required" };
  if (!value) return { valid: false, error: "Record value is required" };

  const allowed = ALLOWED_USER_TEXT_RECORD_KEYS as readonly string[];
  if (!allowed.includes(key)) {
    return {
      valid: false,
      error: `Key "${key}" is not allowed. Allowed keys: ${allowed.join(", ")}`,
    };
  }

  if (value.length > 512) {
    return { valid: false, error: "Record value must be at most 512 characters" };
  }

  return { valid: true };
}
