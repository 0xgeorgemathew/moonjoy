alter table public.matches
  add column if not exists invited_user_id uuid references public.users(id) on delete set null,
  add column if not exists invite_code text;

create index if not exists idx_matches_invited_user_open
  on public.matches(invited_user_id, created_at desc)
  where status = 'created' and opponent_agent_id is null;

create table if not exists public.token_universe_tokens (
  id uuid primary key default gen_random_uuid(),
  chain_id integer not null check (chain_id = 8453),
  address text not null,
  symbol text not null,
  name text not null,
  decimals integer not null check (decimals >= 0 and decimals <= 36),
  risk_tier text not null check (risk_tier in ('blue_chip', 'pink_slip', 'discovered')),
  is_active boolean not null default true,
  source text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (chain_id, address)
);

create table if not exists public.match_token_allowlists (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  token_id uuid not null references public.token_universe_tokens(id),
  admitted_by text not null,
  admitted_at timestamptz not null default now(),
  discovery_snapshot_id uuid,
  unique (match_id, token_id)
);

create table if not exists public.quote_snapshots (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references public.matches(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete set null,
  chain_id integer not null check (chain_id = 8453),
  source text not null check (source = 'uniswap'),
  request_id text,
  token_in text not null,
  token_out text not null,
  amount_in text not null,
  quoted_amount_out text not null,
  routing text not null,
  route_summary jsonb not null default '{}'::jsonb,
  gas_estimate text,
  gas_fee_usd numeric(18, 8),
  price_impact_bps integer,
  slippage_bps integer not null,
  request_payload jsonb not null,
  response_payload jsonb not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists public.simulated_trades (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  seat text not null check (seat in ('creator', 'opponent')),
  phase text not null,
  token_in text not null,
  token_out text not null,
  amount_in text not null,
  quoted_amount_out text not null,
  simulated_amount_out text not null,
  slippage_bps integer not null,
  quote_snapshot_id uuid not null references public.quote_snapshots(id),
  status text not null check (status in ('accepted', 'rejected')),
  failure_reason text,
  accepted_at timestamptz not null default now()
);

create table if not exists public.portfolio_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  trade_id uuid references public.simulated_trades(id) on delete set null,
  entry_type text not null check (entry_type in ('starting_balance', 'trade_debit', 'trade_credit', 'penalty')),
  token_address text,
  amount_base_units text,
  value_usd numeric(18, 8),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.portfolio_valuation_snapshots (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  phase text not null,
  starting_value_usd numeric(18, 8) not null,
  current_value_usd numeric(18, 8) not null,
  realized_pnl_usd numeric(18, 8) not null,
  unrealized_pnl_usd numeric(18, 8) not null,
  total_pnl_usd numeric(18, 8) not null,
  pnl_percent numeric(18, 8) not null,
  penalties_usd numeric(18, 8) not null,
  net_score_percent numeric(18, 8) not null,
  max_drawdown_percent numeric(18, 8) not null default 0,
  quote_snapshot_ids uuid[] not null default '{}',
  stale boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.mandatory_window_results (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  window_name text not null check (window_name in ('opening_window', 'closing_window')),
  completed boolean not null,
  penalty_usd numeric(18, 8) not null default 0,
  assessed_at timestamptz not null default now(),
  unique (match_id, agent_id, window_name)
);

create table if not exists public.strategy_planning_messages (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references public.agents(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  match_id uuid references public.matches(id) on delete cascade,
  strategy_id uuid references public.strategies(id) on delete set null,
  role text not null check (role in ('user', 'agent', 'system')),
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_match_token_allowlists_match
  on public.match_token_allowlists(match_id);

create index if not exists idx_quote_snapshots_match_created
  on public.quote_snapshots(match_id, fetched_at desc);

create index if not exists idx_simulated_trades_match_accepted
  on public.simulated_trades(match_id, accepted_at asc);

create index if not exists idx_portfolio_ledger_match_agent
  on public.portfolio_ledger_entries(match_id, agent_id, created_at asc);

create index if not exists idx_portfolio_valuation_match_agent_created
  on public.portfolio_valuation_snapshots(match_id, agent_id, created_at desc);

create index if not exists idx_strategy_planning_messages_user_agent
  on public.strategy_planning_messages(user_id, agent_id, created_at asc);

insert into public.token_universe_tokens (
  chain_id,
  address,
  symbol,
  name,
  decimals,
  risk_tier,
  source
)
values
  (8453, '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 'USDC', 'USD Coin', 6, 'blue_chip', 'system'),
  (8453, '0x4200000000000000000000000000000000000006', 'WETH', 'Wrapped Ether', 18, 'blue_chip', 'system')
on conflict (chain_id, address) do update
set
  symbol = excluded.symbol,
  name = excluded.name,
  decimals = excluded.decimals,
  risk_tier = excluded.risk_tier,
  is_active = true,
  updated_at = now();

create or replace function public.create_open_match(
  p_match_id uuid,
  p_creator_user_id uuid,
  p_creator_agent_id uuid,
  p_creator_smart_account_address text,
  p_wager_usd numeric,
  p_live_duration_seconds integer,
  p_warmup_duration_seconds integer,
  p_settlement_grace_seconds integer,
  p_starting_capital_usd numeric,
  p_created_at timestamptz,
  p_invited_user_id uuid default null,
  p_invite_code text default null
)
returns public.matches
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_match public.matches;
begin
  perform pg_advisory_xact_lock(hashtext(p_creator_agent_id::text));

  if p_invited_user_id is not null and p_invited_user_id = p_creator_user_id then
    raise exception 'You cannot invite yourself.'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.matches
    where (
      creator_agent_id = p_creator_agent_id
      or opponent_agent_id = p_creator_agent_id
    )
    and status in ('created', 'warmup', 'live', 'settling')
  ) then
    raise exception 'This agent already has an active or open match.'
      using errcode = 'P0001';
  end if;

  insert into public.matches (
    id,
    creator_user_id,
    creator_agent_id,
    creator_smart_account_address,
    invited_user_id,
    invite_code,
    status,
    wager_usd,
    live_duration_seconds,
    warmup_duration_seconds,
    settlement_grace_seconds,
    starting_capital_usd,
    result_summary,
    created_at,
    updated_at
  )
  values (
    p_match_id,
    p_creator_user_id,
    p_creator_agent_id,
    p_creator_smart_account_address,
    p_invited_user_id,
    p_invite_code,
    'created',
    p_wager_usd,
    p_live_duration_seconds,
    p_warmup_duration_seconds,
    p_settlement_grace_seconds,
    p_starting_capital_usd,
    '{}'::jsonb,
    p_created_at,
    now()
  )
  returning * into v_match;

  return v_match;
end;
$$;

create or replace function public.accept_open_match(
  p_match_id uuid,
  p_opponent_user_id uuid,
  p_opponent_agent_id uuid,
  p_opponent_smart_account_address text,
  p_accepted_at timestamptz
)
returns public.matches
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_current public.matches;
  v_match public.matches;
  v_first_lock text;
  v_second_lock text;
begin
  select *
  into v_current
  from public.matches
  where id = p_match_id;

  if not found then
    raise exception 'Match not found.'
      using errcode = 'P0001';
  end if;

  if v_current.creator_agent_id = p_opponent_agent_id then
    raise exception 'You cannot accept your own challenge.'
      using errcode = 'P0001';
  end if;

  if v_current.invited_user_id is not null and v_current.invited_user_id <> p_opponent_user_id then
    raise exception 'This invite is for a different user.'
      using errcode = 'P0001';
  end if;

  v_first_lock := least(v_current.creator_agent_id::text, p_opponent_agent_id::text);
  v_second_lock := greatest(v_current.creator_agent_id::text, p_opponent_agent_id::text);

  perform pg_advisory_xact_lock(hashtext(v_first_lock));
  if v_second_lock <> v_first_lock then
    perform pg_advisory_xact_lock(hashtext(v_second_lock));
  end if;

  select *
  into v_current
  from public.matches
  where id = p_match_id
  for update;

  if v_current.status <> 'created' or v_current.opponent_agent_id is not null then
    raise exception 'Challenge was already accepted or is no longer available.'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.matches
    where id <> p_match_id
      and (
        creator_agent_id = p_opponent_agent_id
        or opponent_agent_id = p_opponent_agent_id
      )
      and status in ('created', 'warmup', 'live', 'settling')
  ) then
    raise exception 'This agent already has an active or open match.'
      using errcode = 'P0001';
  end if;

  update public.matches
  set
    opponent_user_id = p_opponent_user_id,
    opponent_agent_id = p_opponent_agent_id,
    opponent_smart_account_address = p_opponent_smart_account_address,
    status = 'warmup',
    warmup_started_at = p_accepted_at,
    updated_at = now()
  where id = p_match_id
  returning * into v_match;

  return v_match;
end;
$$;
