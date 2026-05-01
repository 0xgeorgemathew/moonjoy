create table if not exists matches (
  id uuid primary key default gen_random_uuid(),
  creator_user_id uuid not null references users(id) on delete cascade,
  creator_agent_id uuid not null references agents(id) on delete cascade,
  creator_smart_account_address text not null,
  opponent_user_id uuid references users(id) on delete set null,
  opponent_agent_id uuid references agents(id) on delete set null,
  opponent_smart_account_address text,
  status text not null,
  wager_usd numeric(12, 2) not null default 10,
  live_duration_seconds integer not null default 300,
  warmup_duration_seconds integer not null default 30,
  settlement_grace_seconds integer not null default 15,
  starting_capital_usd numeric(12, 2) not null default 100,
  winner_seat text,
  winner_agent_id uuid references agents(id) on delete set null,
  result_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  warmup_started_at timestamptz,
  live_started_at timestamptz,
  live_ends_at timestamptz,
  settling_started_at timestamptz,
  settled_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint matches_status_check
    check (status in ('created', 'warmup', 'live', 'settling', 'settled')),
  constraint matches_winner_seat_check
    check (winner_seat in ('creator', 'opponent') or winner_seat is null),
  constraint matches_positive_wager_check
    check (wager_usd > 0),
  constraint matches_positive_live_duration_check
    check (live_duration_seconds > 0),
  constraint matches_positive_warmup_duration_check
    check (warmup_duration_seconds >= 0),
  constraint matches_positive_settlement_grace_check
    check (settlement_grace_seconds >= 0),
  constraint matches_positive_starting_capital_check
    check (starting_capital_usd > 0)
);

create index if not exists idx_matches_status_created_at
  on matches(status, created_at desc);

create index if not exists idx_matches_creator_agent_status
  on matches(creator_agent_id, status, updated_at desc);

create index if not exists idx_matches_opponent_agent_status
  on matches(opponent_agent_id, status, updated_at desc);

create index if not exists idx_matches_creator_user_updated_at
  on matches(creator_user_id, updated_at desc);

create index if not exists idx_matches_opponent_user_updated_at
  on matches(opponent_user_id, updated_at desc);

create table if not exists match_events (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_match_events_match_created_at
  on match_events(match_id, created_at desc);

alter table matches enable row level security;
alter table match_events enable row level security;

create policy "Users can read own matches"
  on matches for select
  to authenticated
  using (
    creator_user_id in (
      select id from users where privy_user_id = ((select auth.jwt()) ->> 'sub')
    )
    or opponent_user_id in (
      select id from users where privy_user_id = ((select auth.jwt()) ->> 'sub')
    )
  );

create policy "Users can read own match events"
  on match_events for select
  to authenticated
  using (
    match_id in (
      select id from matches
      where creator_user_id in (
        select id from users where privy_user_id = ((select auth.jwt()) ->> 'sub')
      )
      or opponent_user_id in (
        select id from users where privy_user_id = ((select auth.jwt()) ->> 'sub')
      )
    )
  );
