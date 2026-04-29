create table if not exists mcp_oauth_clients (
  client_id text primary key,
  client_name text not null,
  redirect_uris text[] not null,
  token_endpoint_auth_method text not null default 'none',
  grant_types text[] not null default array['authorization_code'],
  response_types text[] not null default array['code'],
  scope text,
  raw_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists mcp_oauth_authorization_codes (
  code text primary key,
  client_id text not null references mcp_oauth_clients(client_id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  code_challenge_method text not null default 'S256',
  scope text,
  resource text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_mcp_oauth_codes_client_id
  on mcp_oauth_authorization_codes(client_id);

create index if not exists idx_mcp_oauth_codes_agent_id
  on mcp_oauth_authorization_codes(agent_id);

alter table mcp_oauth_clients enable row level security;
alter table mcp_oauth_authorization_codes enable row level security;
