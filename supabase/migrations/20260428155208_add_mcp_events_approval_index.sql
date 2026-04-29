create index if not exists idx_mcp_events_approval_id
  on mcp_events(approval_id)
  where approval_id is not null;
