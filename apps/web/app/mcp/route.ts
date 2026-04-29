import { randomUUID } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createMoonjoyMcpServer } from "@/lib/services/moonjoy-mcp-server";
import { getRequestOrigin } from "@/lib/services/request-origin-service";
import { recordMcpEvent } from "@/lib/services/mcp-event-service";
import {
  startMcpSessionHeartbeat,
  stopMcpSessionHeartbeat,
} from "@/lib/services/mcp-session-heartbeat-service";
import {
  deleteMcpSession,
  getMcpSession,
  registerMcpSession,
} from "@/lib/services/mcp-session-notification-service";
import {
  McpAuthError,
  verifyMcpBearerToken,
} from "@/lib/services/mcp-auth-service";
import type { McpRuntimeContext } from "@/lib/types/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleMcpRequest(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleMcpRequest(request);
}

export async function DELETE(request: Request): Promise<Response> {
  return handleMcpRequest(request);
}

export async function OPTIONS(): Promise<Response> {
  return withCors(new Response(null, { status: 204 }));
}

async function handleMcpRequest(request: Request): Promise<Response> {
  const requestOrigin = getRequestOrigin(request);
  let context: McpRuntimeContext;
  try {
    const authenticatedContext = await verifyMcpBearerToken(
      request.headers.get("authorization"),
    );
    context = {
      ...authenticatedContext,
      requestOrigin,
    };
  } catch (err) {
    return unauthorizedResponse(err, requestOrigin);
  }

  const sessionId = request.headers.get("mcp-session-id") ?? undefined;
  const parsedBody = request.method === "POST" ? await readJsonBody(request) : undefined;

  try {
    if (sessionId) {
      const session = getMcpSession(sessionId);
      if (!session) {
        return jsonRpcError("Invalid or expired MCP session", 404);
      }

      if (session.context.approvalId !== context.approvalId) {
        return jsonRpcError("MCP session does not belong to this approval", 403);
      }

      const response = await session.transport.handleRequest(request, {
        parsedBody,
        authInfo: authInfoFromContext(context),
      });
      return withCors(response);
    }

    if (request.method !== "POST" || !isInitializeRequest(parsedBody)) {
      return jsonRpcError("Missing MCP session. Initialize a session first.", 400);
    }

    let initializedSessionId: string | null = null;
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: async (newSessionId) => {
        initializedSessionId = newSessionId;
        registerMcpSession(newSessionId, { transport, context });
        startMcpSessionHeartbeat(newSessionId, context);
        await recordMcpEvent(context, "session.initialized", {
          sessionId: newSessionId,
          clientName: context.clientName,
        });
      },
      onsessionclosed: async (closedSessionId) => {
        stopMcpSessionHeartbeat(closedSessionId);
        deleteMcpSession(closedSessionId);
        await recordMcpEvent(context, "session.closed", {
          sessionId: closedSessionId,
          clientName: context.clientName,
        });
      },
    });

    transport.onclose = () => {
      if (initializedSessionId) {
        stopMcpSessionHeartbeat(initializedSessionId);
        deleteMcpSession(initializedSessionId);
      }
    };

    const server = createMoonjoyMcpServer(context);
    await server.connect(transport);
    const response = await transport.handleRequest(request, {
      parsedBody,
      authInfo: authInfoFromContext(context),
    });
    return withCors(response);
  } catch (err) {
    console.error("[mcp] Request failed", err);
    return jsonRpcError("Internal MCP server error", 500);
  }
}

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.clone().json();
  } catch {
    return undefined;
  }
}

function authInfoFromContext(context: McpRuntimeContext) {
  return {
    token: "redacted",
    clientId: context.subject,
    scopes: context.scopes,
    extra: {
      approvalId: context.approvalId,
      agentId: context.agentId,
      userId: context.userId,
    },
  };
}

function unauthorizedResponse(err: unknown, origin: string): Response {
  const status = err instanceof McpAuthError ? err.statusCode : 401;
  const message =
    err instanceof Error ? err.message : "MCP authorization failed";
  return withCors(
    Response.json(
      {
        jsonrpc: "2.0",
        error: {
          code: status === 403 ? -32003 : -32001,
          message,
        },
        id: null,
      },
      {
        status,
        headers: {
          "WWW-Authenticate": `Bearer realm="Moonjoy MCP", resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
        },
      },
    ),
  );
}

function jsonRpcError(message: string, status: number): Response {
  return withCors(
    Response.json(
      {
        jsonrpc: "2.0",
        error: {
          code: status === 404 ? -32004 : -32000,
          message,
        },
        id: null,
      },
      { status },
    ),
  );
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, mcp-session-id, mcp-protocol-version, Last-Event-ID",
  );
  headers.set("Access-Control-Expose-Headers", "mcp-session-id, mcp-protocol-version");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
