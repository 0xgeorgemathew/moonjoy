import { resolveTextRecord } from "@/lib/services/ens-service";
import { downloadManifest, parsePointer } from "@/lib/services/zero-g-storage-service";

export async function resolveAgentStrategy(
  agentEnsName: string,
): Promise<Record<string, unknown> | null> {
  return resolveAgentStrategyRecord(agentEnsName, "moonjoy:strategy");
}

export async function resolveAgentStrategyRecord(
  agentEnsName: string,
  recordKey: string,
): Promise<Record<string, unknown> | null> {
  const label = agentEnsName.endsWith(".moonjoy.eth")
    ? agentEnsName.slice(0, -".moonjoy.eth".length)
    : agentEnsName;

  const pointer = await resolveTextRecord(label, recordKey);
  if (!pointer) return null;

  try {
    return await resolveStrategyFromPointer(pointer);
  } catch {
    return null;
  }
}

export async function resolveStrategyFromPointer(
  pointer: string,
): Promise<Record<string, unknown> | null> {
  const parsed = parsePointer(pointer);
  if (!parsed) return null;
  return downloadManifest(parsed.rootHash);
}
