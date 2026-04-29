import { createAdminClient } from "@/lib/supabase/admin";
import type { McpEventType, McpRuntimeContext } from "@/lib/types/mcp";

type EventPayload = Record<string, unknown>;

export async function recordMcpEvent(
  context: Pick<McpRuntimeContext, "agentId" | "userId" | "approvalId">,
  eventType: McpEventType,
  payload: EventPayload = {},
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.from("mcp_events").insert({
    agent_id: context.agentId,
    user_id: context.userId,
    approval_id: context.approvalId,
    event_type: eventType,
    payload,
  });

  if (error) {
    console.error("[mcp] Failed to record event", error);
    return;
  }

  await broadcastMcpEvent(context.agentId, eventType, payload);
}

async function broadcastMcpEvent(
  agentId: string,
  eventType: McpEventType,
  payload: EventPayload,
): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) return;

  try {
    await fetch(`${url}/rest/v1/rpc/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        topic: `mcp:agent:${agentId}:events`,
        event: eventType,
        payload: {
          ...payload,
          agentId,
          eventType,
          createdAt: new Date().toISOString(),
        },
        private: false,
      }),
    });
  } catch (err) {
    console.error("[mcp] Failed to broadcast event", err);
  }
}
