import type { Address } from "viem";
import { isAddress } from "viem";

export function normalizeAddress(address: string): Address {
  return isAddress(address) ? address : (`${address}` as Address);
}

export function isEvmAddress(address: string): address is Address {
  return isAddress(address);
}

export function extractEmbeddedSignerAddress(
  wallets: { address: string; walletClientType: string }[],
): string | null {
  const embedded = wallets.find(
    (w) => w.walletClientType === "privy",
  );
  return embedded?.address ?? null;
}

export function extractSmartAccountAddress(
  client: { account: { address: string } } | undefined,
): string | null {
  return client?.account?.address ?? null;
}
