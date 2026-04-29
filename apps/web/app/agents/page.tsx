import { PhasePlaceholder } from "@/components/phase-placeholder";

export default function AgentsPage() {
  return (
    <PhasePlaceholder
      eyebrow="Agent Ops"
      title="Agent Bootstrap"
      body="After MCP approval, the agent now owns the next setup steps: claim the derived ENS identity, create the default strategy, and publish the public MCP and strategy pointers through Moonjoy MCP tools."
      items={[
        "local: http://localhost:3000/mcp",
        "live: https://moonjoy.up.railway.app/mcp",
        "tools: claim identity, create strategy, update strategy",
      ]}
    />
  );
}
