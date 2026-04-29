alter table agents
  add column if not exists execution_signer_id text,
  add column if not exists execution_signer_provider text not null default 'none',
  add column if not exists execution_key_expires_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'agents_execution_signer_provider_check'
      and conrelid = 'public.agents'::regclass
  ) then
    alter table agents
      add constraint agents_execution_signer_provider_check
      check (execution_signer_provider in ('none', 'privy_authorization_key'));
  end if;
end
$$;

alter table mcp_approvals
  add column if not exists execution_signer_id text,
  add column if not exists execution_wallet_id text,
  add column if not exists execution_key_ciphertext text,
  add column if not exists execution_key_expires_at timestamptz;

alter table mcp_oauth_authorization_codes
  add column if not exists execution_signer_id text,
  add column if not exists execution_wallet_id text,
  add column if not exists execution_key_ciphertext text,
  add column if not exists execution_key_expires_at timestamptz;

create table if not exists strategies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  agent_smart_account_address text not null,
  name text not null,
  source_type text not null,
  manifest_body jsonb not null default '{}'::jsonb,
  manifest_pointer text not null,
  local_revision integer not null default 1,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint strategies_source_type_check
    check (
      source_type in (
        'user_prompt',
        'md_context',
        'agent_generated_plan',
        'keeperhub_workflow',
        'default_behavior'
      )
    ),
  constraint strategies_local_revision_check check (local_revision >= 1),
  constraint strategies_status_check
    check (status in ('draft', 'active', 'archived'))
);

create unique index if not exists idx_strategies_one_active_per_agent
  on strategies(agent_id)
  where status = 'active';

create index if not exists idx_strategies_user_id
  on strategies(user_id);

create index if not exists idx_strategies_agent_id
  on strategies(agent_id);

create index if not exists idx_strategies_agent_address
  on strategies(lower(agent_smart_account_address));

create table if not exists strategy_decisions (
  id uuid primary key default gen_random_uuid(),
  strategy_id uuid not null references strategies(id) on delete cascade,
  match_id text,
  trade_id text,
  rationale text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_strategy_decisions_strategy_created_at
  on strategy_decisions(strategy_id, created_at desc);

alter table strategies enable row level security;
alter table strategy_decisions enable row level security;

create policy "Users can read own strategies"
  on strategies for select
  to authenticated
  using (user_id in (
    select id from users where privy_user_id = ((select auth.jwt()) ->> 'sub')
  ));

create policy "Users can insert own strategies"
  on strategies for insert
  to authenticated
  with check (user_id in (
    select id from users where privy_user_id = ((select auth.jwt()) ->> 'sub')
  ));

create policy "Users can update own strategies"
  on strategies for update
  to authenticated
  using (user_id in (
    select id from users where privy_user_id = ((select auth.jwt()) ->> 'sub')
  ))
  with check (user_id in (
    select id from users where privy_user_id = ((select auth.jwt()) ->> 'sub')
  ));

create policy "Users can read own strategy decisions"
  on strategy_decisions for select
  to authenticated
  using (strategy_id in (
    select id from strategies
    where user_id in (
      select id from users where privy_user_id = ((select auth.jwt()) ->> 'sub')
    )
  ));

create policy "Users can insert own strategy decisions"
  on strategy_decisions for insert
  to authenticated
  with check (strategy_id in (
    select id from strategies
    where user_id in (
      select id from users where privy_user_id = ((select auth.jwt()) ->> 'sub')
    )
  ));
