alter table matches
  drop constraint if exists matches_status_check;

alter table matches
  add constraint matches_status_check
  check (status in ('created', 'warmup', 'live', 'settling', 'settled', 'canceled'));

create index if not exists idx_matches_creator_open_challenge
  on matches(creator_agent_id, updated_at desc)
  where status = 'created' and opponent_agent_id is null;
