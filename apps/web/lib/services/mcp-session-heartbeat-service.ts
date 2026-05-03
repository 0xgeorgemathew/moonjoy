import { getActiveMatchSnapshotForMcpContext } from "@/lib/services/match-service";
import type { McpRuntimeContext } from "@/lib/types/mcp";

const HEARTBEAT_INTERVAL_MS = 5_000;

const globalForMcpHeartbeats = globalThis as typeof globalThis & {
  moonjoyMcpHeartbeats?: Map<string, ReturnType<typeof setInterval>>;
};

const heartbeats =
  globalForMcpHeartbeats.moonjoyMcpHeartbeats ??
  new Map<string, ReturnType<typeof setInterval>>();
globalForMcpHeartbeats.moonjoyMcpHeartbeats = heartbeats;

export function startMcpSessionHeartbeat(
  sessionId: string,
  context: McpRuntimeContext,
): void {
  stopMcpSessionHeartbeat(sessionId);

  const interval = setInterval(() => {
    void reconcileActiveMatch(sessionId, context);
  }, HEARTBEAT_INTERVAL_MS);

  heartbeats.set(sessionId, interval);
  void reconcileActiveMatch(sessionId, context);
}

export function stopMcpSessionHeartbeat(sessionId: string): void {
  const interval = heartbeats.get(sessionId);
  if (!interval) {
    return;
  }

  clearInterval(interval);
  heartbeats.delete(sessionId);
}

async function reconcileActiveMatch(
  sessionId: string,
  context: McpRuntimeContext,
): Promise<void> {
  try {
    await getActiveMatchSnapshotForMcpContext(context);
  } catch (error) {
    console.error("[mcp] Heartbeat failed to reconcile active match", {
      sessionId,
      error,
    });
  }
}
