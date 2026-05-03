import { Indexer, MemData } from "@0gfoundation/0g-ts-sdk";
import { ethers } from "ethers";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sortObjectKeys } from "@/lib/services/agent-bootstrap-utils";

const RPC_URL = process.env.ZERO_G_TESTNET_RPC_URL!;
const INDEXER_URL = process.env.ZERO_G_TESTNET_INDEXER_URL!;
const PRIVATE_KEY = process.env.ZERO_G_TESTNET_PRIVATE_KEY!;
const POINTER_NETWORK = "testnet-turbo";

export type ZeroGUploadResult = {
  rootHash: string;
  txHash: string;
  pointer: string;
};

function requireConfig(): void {
  if (!RPC_URL || !INDEXER_URL || !PRIVATE_KEY) {
    throw new Error(
      "0G Storage is not configured. Set ZERO_G_TESTNET_RPC_URL, ZERO_G_TESTNET_INDEXER_URL, and ZERO_G_TESTNET_PRIVATE_KEY.",
    );
  }
}

function createSigner(): ethers.Wallet {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  return new ethers.Wallet(PRIVATE_KEY, provider);
}

function createIndexer(): Indexer {
  return new Indexer(INDEXER_URL);
}

export async function uploadManifest(
  manifest: Record<string, unknown>,
): Promise<ZeroGUploadResult> {
  return uploadJsonDocument(manifest, { addPublishedAt: true });
}

export async function uploadJsonDocument(
  document: Record<string, unknown>,
  options: { addPublishedAt?: boolean } = {},
): Promise<ZeroGUploadResult> {
  requireConfig();

  const sorted = sortObjectKeys(document) as Record<string, unknown>;
  const payload: Record<string, unknown> = {
    ...sorted,
    ...(options.addPublishedAt ? { publishedAt: new Date().toISOString() } : {}),
  };
  const canonicalJson = JSON.stringify(sortObjectKeys(payload));
  const bytes = new TextEncoder().encode(canonicalJson);

  const memData = new MemData(bytes);
  const signer = createSigner();
  const indexer = createIndexer();
  const [, treeErr] = await memData.merkleTree();

  if (treeErr) {
    throw new Error(`0G Storage merkle tree build failed: ${treeErr.message}`);
  }

  const [result, err] = await indexer.upload(memData, RPC_URL, signer);

  if (err) {
    throw new Error(`0G Storage upload failed: ${err.message}`);
  }

  if (!result || !("rootHash" in result) || !result.rootHash) {
    throw new Error(
      "0G Storage upload returned an unexpected response with no rootHash.",
    );
  }
  if (!("txHash" in result) || !result.txHash) {
    throw new Error(
      "0G Storage upload returned an unexpected response with no txHash.",
    );
  }

  return {
    rootHash: result.rootHash,
    txHash: result.txHash,
    pointer: `0g://${POINTER_NETWORK}/${result.rootHash}`,
  };
}

export async function downloadManifest(
  rootHash: string,
): Promise<Record<string, unknown>> {
  return downloadJsonDocument(rootHash);
}

export async function downloadJsonDocument(
  rootHash: string,
): Promise<Record<string, unknown>> {
  requireConfig();

  const indexer = createIndexer();
  const tempDir = await mkdtemp(join(tmpdir(), "moonjoy-0g-"));
  const outputPath = join(tempDir, `${rootHash}.json`);

  try {
    const err = await indexer.download(rootHash, outputPath, true);

    if (err) {
      throw new Error(`0G Storage download failed: ${err.message}`);
    }

    const text = await readFile(outputPath, "utf8");
    if (!text.trim()) {
      throw new Error("0G Storage download returned empty data.");
    }

    return JSON.parse(text) as Record<string, unknown>;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export function parsePointer(
  pointer: string,
): { network: string; mode: string; rootHash: string } | null {
  const match = pointer.match(/^0g:\/\/([a-z0-9]+)-([a-z0-9]+)\/(0x[a-f0-9]+)$/i);
  if (!match) return null;
  return {
    network: match[1].toLowerCase(),
    mode: match[2].toLowerCase(),
    rootHash: match[3],
  };
}
