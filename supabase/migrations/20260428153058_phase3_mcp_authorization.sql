create table if not exists mcp_approvals (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agents(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  client_name text not null,
  mcp_subject text not null,
  token_hash text not null unique,
  token_prefix text not null,
  scopes text[] not null default array['moonjoy:read', 'moonjoy:agent'],
  status text not null default 'active',
  approved_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mcp_approvals_status_check check (status in ('active', 'revoked'))
);

create unique index if not exists idx_mcp_approvals_one_active_agent
  on mcp_approvals(agent_id)
  where status = 'active';

create index if not exists idx_mcp_approvals_user_id
  on mcp_approvals(user_id);

create index if not exists idx_mcp_approvals_token_hash
  on mcp_approvals(token_hash)
  where status = 'active';

create table if not exists mcp_events (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agents(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  approval_id uuid references mcp_approvals(id) on delete set null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_mcp_events_agent_created_at
  on mcp_events(agent_id, created_at desc);

create index if not exists idx_mcp_events_user_created_at
  on mcp_events(user_id, created_at desc);

alter table mcp_approvals enable row level security;
alter table mcp_events enable row level security;

create policy "Users can read own MCP approvals"
  on mcp_approvals for select
  to authenticated
  using (user_id in (
    select id from users where privy_user_id = ((select auth.jwt()) ->> 'sub')
  ));

create policy "Users can read own MCP events"
  on mcp_events for select
  to authenticated
  using (user_id in (
    select id from users where privy_user_id = ((select auth.jwt()) ->> 'sub')
  ));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table mcp_events;
    exception
      when duplicate_object then null;
      when undefined_object then null;
    end;
  end if;
end
$$;
