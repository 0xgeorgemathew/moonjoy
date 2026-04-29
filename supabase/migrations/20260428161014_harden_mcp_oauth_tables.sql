create index if not exists idx_mcp_oauth_codes_user_id
  on mcp_oauth_authorization_codes(user_id);

create policy "No direct client access to MCP OAuth clients"
  on mcp_oauth_clients
  for all
  to anon, authenticated
  using (false)
  with check (false);

create policy "No direct client access to MCP OAuth authorization codes"
  on mcp_oauth_authorization_codes
  for all
  to anon, authenticated
  using (false)
  with check (false);
