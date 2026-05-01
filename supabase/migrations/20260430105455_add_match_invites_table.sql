-- Add match_invites table for open and ENS-scoped invite matchmaking
-- Reconstructed from remote schema

create table if not exists public.match_invites (
  id uuid primary key default gen_random_uuid(),
  created_by_user_id uuid not null references public.users(id),
  creator_agent_id uuid not null references public.agents(id),
  invite_token uuid not null unique default gen_random_uuid(),
  scope_type text not null check (scope_type in ('open', 'ens')),
  scoped_ens_name text,
  wager_usd numeric not null default 10 check (wager_usd > 0),
  duration_seconds integer not null default 300 check (duration_seconds > 0),
  warmup_seconds integer not null default 30 check (warmup_seconds >= 0),
  status text not null default 'open' check (status in ('open', 'joined', 'revoked', 'expired')),
  created_match_id uuid references public.matches(id),
  joiner_user_id uuid references public.users(id),
  joiner_agent_id uuid references public.agents(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.match_invites enable row level security;

create policy "match_invites_service_role_only"
  on public.match_invites for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create index if not exists idx_match_invites_token
  on public.match_invites (invite_token);

create index if not exists idx_match_invites_status
  on public.match_invites (status);

create index if not exists idx_match_invites_creator
  on public.match_invites (created_by_user_id);

create index if not exists idx_match_invites_creator_agent_id
  on public.match_invites (creator_agent_id);

create index if not exists idx_match_invites_joiner_user_id
  on public.match_invites (joiner_user_id);

create index if not exists idx_match_invites_joiner_agent_id
  on public.match_invites (joiner_agent_id);

create index if not exists idx_match_invites_created_match_id
  on public.match_invites (created_match_id);

create index if not exists idx_match_invites_expires
  on public.match_invites (expires_at)
  where status = 'open';

create index if not exists idx_match_invites_scoped_ens_status
  on public.match_invites (scoped_ens_name, status)
  where scoped_ens_name is not null;
