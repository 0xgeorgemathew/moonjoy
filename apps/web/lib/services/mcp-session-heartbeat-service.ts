import { getActiveMatchSnapshotForMcpContext } from "@/lib/services/match-service";
import { autoAdvanceMoonjoy } from "@/lib/services/mcp-context-service";
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
    const snapshot = await getActiveMatchSnapshotForMcpContext(context);

    const shouldAutoJoin =
      snapshot.openChallengeCount > 0 &&
      (!snapshot.activeMatch ||
        (snapshot.activeMatch.status === "created" &&
          snapshot.activeMatch.viewerSeat === "creator" &&
          snapshot.activeMatch.opponent === null));

    const shouldAutoPlay = snapshot.activeMatch?.status === "live";

    if (shouldAutoJoin || shouldAutoPlay) {
      await autoAdvanceMoonjoy(context, { createIfNoJoinable: false });
    }
  } catch (error) {
    console.error("[mcp] Heartbeat failed to reconcile active match", {
      sessionId,
      error,
    });
  }
}
