-- Phase 6: Trading game tables for simulated trading, portfolio tracking, and match events
-- Reconstructed from remote schema

-- ============================================================
-- Token Universe
-- ============================================================

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

alter table public.token_universe_tokens enable row level security;

create policy "Service role full access to token_universe_tokens"
  on public.token_universe_tokens for all
  to service_role using (true) with check (true);

create index if not exists idx_token_universe_chain_address
  on public.token_universe_tokens (chain_id, address);

create index if not exists idx_token_universe_risk_tier
  on public.token_universe_tokens (risk_tier) where is_active;

-- ============================================================
-- Token Discovery Snapshots
-- ============================================================

create table if not exists public.token_discovery_snapshots (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references public.matches(id) on delete cascade,
  query text,
  raw_source text not null check (raw_source = 'dexscreener'),
  raw_payload jsonb not null,
  filtered_payload jsonb not null,
  rejected_payload jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.token_discovery_snapshots enable row level security;

create policy "Service role full access to token_discovery_snapshots"
  on public.token_discovery_snapshots for all
  to service_role using (true) with check (true);

create index if not exists idx_token_discovery_match
  on public.token_discovery_snapshots (match_id, created_at desc);

-- ============================================================
-- Match Events
-- ============================================================

create table if not exists public.match_events (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.match_events enable row level security;

create policy "Users can read own match events"
  on public.match_events for select
  to authenticated
  using (
    match_id in (
      select matches.id from public.matches
      where
        matches.creator_user_id in (
          select users.id from public.users
          where users.privy_user_id = auth.jwt() ->> 'sub'
        )
        or matches.opponent_user_id in (
          select users.id from public.users
          where users.privy_user_id = auth.jwt() ->> 'sub'
        )
    )
  );

create index if not exists idx_match_events_match_created_at
  on public.match_events (match_id, created_at desc);

-- ============================================================
-- Quote Snapshots
-- ============================================================

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
  gas_fee_usd numeric,
  price_impact_bps integer,
  slippage_bps integer not null,
  block_number text,
  request_payload jsonb not null,
  response_payload jsonb not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null
);

alter table public.quote_snapshots enable row level security;

create policy "Service role full access to quote_snapshots"
  on public.quote_snapshots for all
  to service_role using (true) with check (true);

create index if not exists idx_quote_snapshots_match
  on public.quote_snapshots (match_id);

create index if not exists idx_quote_snapshots_agent
  on public.quote_snapshots (agent_id);

create index if not exists idx_quote_snapshots_expires
  on public.quote_snapshots (expires_at);

-- ============================================================
-- Simulated Trades
-- ============================================================

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

alter table public.simulated_trades enable row level security;

create policy "Service role full access to simulated_trades"
  on public.simulated_trades for all
  to service_role using (true) with check (true);

create policy "Users can read own match trading data"
  on public.simulated_trades for select
  to authenticated
  using (
    match_id in (
      select matches.id from public.matches
      where
        matches.creator_user_id in (
          select users.id from public.users
          where users.privy_user_id = auth.jwt() ->> 'sub'
        )
        or matches.opponent_user_id in (
          select users.id from public.users
          where users.privy_user_id = auth.jwt() ->> 'sub'
        )
    )
  );

create index if not exists idx_simulated_trades_match
  on public.simulated_trades (match_id);

create index if not exists idx_simulated_trades_agent_match
  on public.simulated_trades (agent_id, match_id);

create index if not exists idx_simulated_trades_phase
  on public.simulated_trades (phase);

-- ============================================================
-- Portfolio Ledger Entries
-- ============================================================

create table if not exists public.portfolio_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  trade_id uuid references public.simulated_trades(id) on delete set null,
  entry_type text not null check (entry_type in ('starting_balance', 'trade_debit', 'trade_credit', 'penalty')),
  token_address text,
  amount_base_units text,
  value_usd numeric,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.portfolio_ledger_entries enable row level security;

create policy "Service role full access to portfolio_ledger_entries"
  on public.portfolio_ledger_entries for all
  to service_role using (true) with check (true);

create index if not exists idx_portfolio_ledger_match_agent
  on public.portfolio_ledger_entries (match_id, agent_id);

create index if not exists idx_portfolio_ledger_token
  on public.portfolio_ledger_entries (token_address);

-- ============================================================
-- Portfolio Valuation Snapshots
-- ============================================================

create table if not exists public.portfolio_valuation_snapshots (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  phase text not null,
  starting_value_usd numeric not null,
  current_value_usd numeric not null,
  realized_pnl_usd numeric not null,
  unrealized_pnl_usd numeric not null,
  total_pnl_usd numeric not null,
  pnl_percent numeric not null,
  penalties_usd numeric not null,
  net_score_percent numeric not null,
  max_drawdown_percent numeric not null default 0,
  quote_snapshot_ids uuid[] not null default '{}',
  stale boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.portfolio_valuation_snapshots enable row level security;

create policy "Service role full access to portfolio_valuation_snapshots"
  on public.portfolio_valuation_snapshots for all
  to service_role using (true) with check (true);

create policy "Users can read own portfolio data"
  on public.portfolio_valuation_snapshots for select
  to authenticated
  using (
    match_id in (
      select matches.id from public.matches
      where
        matches.creator_user_id in (
          select users.id from public.users
          where users.privy_user_id = auth.jwt() ->> 'sub'
        )
        or matches.opponent_user_id in (
          select users.id from public.users
          where users.privy_user_id = auth.jwt() ->> 'sub'
        )
    )
  );

create index if not exists idx_portfolio_valuation_match_agent
  on public.portfolio_valuation_snapshots (match_id, agent_id, created_at desc);

-- ============================================================
-- Match Token Allowlists
-- ============================================================

create table if not exists public.match_token_allowlists (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  token_id uuid not null references public.token_universe_tokens(id),
  admitted_by text not null,
  admitted_at timestamptz not null default now(),
  discovery_snapshot_id uuid,
  unique (match_id, token_id)
);

alter table public.match_token_allowlists enable row level security;

create policy "Service role full access to match_token_allowlists"
  on public.match_token_allowlists for all
  to service_role using (true) with check (true);

create index if not exists idx_match_token_allowlists_match
  on public.match_token_allowlists (match_id);

-- ============================================================
-- Mandatory Window Results
-- ============================================================

create table if not exists public.mandatory_window_results (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  window_name text not null check (window_name in ('opening_window', 'closing_window')),
  completed boolean not null,
  penalty_usd numeric not null default 0,
  assessed_at timestamptz not null default now(),
  unique (match_id, agent_id, window_name)
);

alter table public.mandatory_window_results enable row level security;

create policy "Service role full access to mandatory_window_results"
  on public.mandatory_window_results for all
  to service_role using (true) with check (true);

create index if not exists idx_mandatory_window_match_agent
  on public.mandatory_window_results (match_id, agent_id);

-- ============================================================
-- Seed Data: Base Blue-Chip Tokens
-- ============================================================

insert into public.token_universe_tokens (
  chain_id, address, symbol, name, decimals, risk_tier, source
) values
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
