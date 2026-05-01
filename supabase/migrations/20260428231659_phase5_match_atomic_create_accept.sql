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
  p_created_at timestamptz
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
