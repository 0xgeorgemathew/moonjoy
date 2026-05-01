-- Phase 6: Strategy planning messages for agent-human chat during match warm-up and live play
-- Reconstructed from remote schema

create table if not exists public.strategy_planning_messages (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  match_id text,
  strategy_id uuid references public.strategies(id) on delete set null,
  role text not null check (role in ('user', 'agent', 'system')),
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.strategy_planning_messages enable row level security;

create policy "Users can read own planning messages"
  on public.strategy_planning_messages for select
  to authenticated
  using (
    user_id in (
      select users.id from public.users
      where users.privy_user_id = auth.jwt() ->> 'sub'
    )
  );

create policy "Users can insert own planning messages"
  on public.strategy_planning_messages for insert
  to authenticated
  with check (
    user_id in (
      select users.id from public.users
      where users.privy_user_id = auth.jwt() ->> 'sub'
    )
  );

create index if not exists idx_planning_messages_agent_created
  on public.strategy_planning_messages (agent_id, created_at desc);

create index if not exists idx_planning_messages_match_created
  on public.strategy_planning_messages (match_id, created_at desc);
