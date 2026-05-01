import type { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { JSONRPCNotification } from "@modelcontextprotocol/sdk/types.js";
import type { McpRuntimeContext } from "@/lib/types/mcp";

export type McpSession = {
  transport: WebStandardStreamableHTTPServerTransport;
  context: McpRuntimeContext;
};

type MatchNotificationInput = {
  agentIds: string[];
  eventType: string;
  matchId: string;
  status: string;
  payload?: Record<string, unknown>;
};

const globalForMcpSessions = globalThis as typeof globalThis & {
  moonjoyMcpSessions?: Map<string, McpSession>;
};

const sessions =
  globalForMcpSessions.moonjoyMcpSessions ?? new Map<string, McpSession>();
globalForMcpSessions.moonjoyMcpSessions = sessions;

export function getMcpSession(sessionId: string): McpSession | null {
  return sessions.get(sessionId) ?? null;
}

export function registerMcpSession(
  sessionId: string,
  session: McpSession,
): void {
  sessions.set(sessionId, session);
}

export function deleteMcpSession(sessionId: string): void {
  sessions.delete(sessionId);
}

export async function notifyMatchEventSessions(
  input: MatchNotificationInput,
): Promise<void> {
  const agentIds = new Set(input.agentIds);
  const deliveries = Array.from(sessions.entries())
    .filter(([, session]) => agentIds.has(session.context.agentId))
    .map(async ([sessionId, session]) => {
      try {
        await session.transport.send(buildMatchNotification(input, sessionId));
      } catch (error) {
        console.error("[mcp] Failed to send match notification", error);
      }
    });

  await Promise.all(deliveries);
}

export async function notifyArenaMatchmakingSessions(
  input: Omit<MatchNotificationInput, "agentIds">,
): Promise<void> {
  const deliveries = Array.from(sessions.entries()).map(
    async ([sessionId, session]) => {
      try {
        await session.transport.send(
          buildMatchNotification(
            {
              ...input,
              agentIds: [session.context.agentId],
            },
            sessionId,
          ),
        );
      } catch (error) {
        console.error("[mcp] Failed to send arena matchmaking notification", error);
      }
    },
  );

  await Promise.all(deliveries);
}

function buildMatchNotification(
  input: MatchNotificationInput,
  sessionId: string,
): JSONRPCNotification {
  return {
    jsonrpc: "2.0",
    method: "notifications/message",
    params: {
      level: "notice",
      logger: "moonjoy.match",
      data: {
        type: "moonjoy.match_state_changed",
        sessionId,
        eventType: input.eventType,
        matchId: input.matchId,
        status: input.status,
        payload: input.payload ?? {},
        recommendedTool: "moonjoy_match:action=heartbeat",
        createdAt: new Date().toISOString(),
      },
    },
  };
}
