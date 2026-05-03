-- Store the concrete trading-capital term on match invites.
-- Invite acceptance creates matches from these stored terms, not from UI/query state.

alter table public.match_invites
  add column if not exists starting_capital_usd numeric not null default 100;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'match_invites_starting_capital_positive'
  ) then
    alter table public.match_invites
      add constraint match_invites_starting_capital_positive
      check (starting_capital_usd > 0);
  end if;
end
$$;

drop function if exists public.create_match_invite(
  uuid,
  uuid,
  text,
  text,
  numeric,
  integer,
  integer,
  timestamptz
);

drop function if exists public.create_match_invite(
  uuid,
  uuid,
  text,
  text,
  numeric,
  integer,
  integer,
  numeric,
  timestamptz
);

create function public.create_match_invite(
  p_created_by_user_id uuid,
  p_creator_agent_id uuid,
  p_scope_type text,
  p_scoped_ens_name text,
  p_wager_usd numeric default 10,
  p_duration_seconds integer default 300,
  p_warmup_seconds integer default 30,
  p_starting_capital_usd numeric default 100,
  p_expires_at timestamptz default null
)
returns public.match_invites
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_invite public.match_invites;
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
    raise exception 'Agent already has an active match.'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.match_invites
    where creator_agent_id = p_creator_agent_id
    and status = 'open'
  ) then
    raise exception 'Agent already has an open invite.'
      using errcode = 'P0001';
  end if;

  insert into public.match_invites (
    created_by_user_id,
    creator_agent_id,
    scope_type,
    scoped_ens_name,
    wager_usd,
    duration_seconds,
    warmup_seconds,
    starting_capital_usd,
    status,
    expires_at
  ) values (
    p_created_by_user_id,
    p_creator_agent_id,
    p_scope_type,
    p_scoped_ens_name,
    p_wager_usd,
    p_duration_seconds,
    p_warmup_seconds,
    p_starting_capital_usd,
    'open',
    p_expires_at
  )
  returning * into v_invite;

  return v_invite;
end;
$function$;

drop function if exists public.join_match_invite(
  uuid,
  uuid,
  uuid,
  text,
  uuid,
  uuid,
  text,
  numeric,
  integer,
  integer
);

drop function if exists public.join_match_invite(
  uuid,
  uuid,
  uuid,
  text,
  uuid,
  uuid,
  text,
  numeric,
  integer,
  integer,
  numeric
);

create function public.join_match_invite(
  p_invite_id uuid,
  p_joiner_user_id uuid,
  p_joiner_agent_id uuid,
  p_joiner_smart_account_address text,
  p_creator_user_id uuid,
  p_creator_agent_id uuid,
  p_creator_smart_account_address text,
  p_wager_usd numeric default 10,
  p_duration_seconds integer default 300,
  p_warmup_seconds integer default 30,
  p_starting_capital_usd numeric default 100
)
returns record
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_invite public.match_invites;
  v_match public.matches;
  v_result record;
  v_match_id uuid;
  v_now timestamptz;
  v_first_lock text;
  v_second_lock text;
begin
  v_now := now();
  v_match_id := gen_random_uuid();

  select * into v_invite
  from public.match_invites
  where id = p_invite_id
  for update;

  if not found then
    raise exception 'Invite not found.' using errcode = 'P0001';
  end if;

  if v_invite.status != 'open' then
    raise exception 'Invite is no longer open: status=%', v_invite.status using errcode = 'P0001';
  end if;

  if v_invite.expires_at is not null and v_now > v_invite.expires_at then
    update public.match_invites set status = 'expired', updated_at = v_now where id = p_invite_id;
    raise exception 'Invite has expired.' using errcode = 'P0001';
  end if;

  if v_invite.created_by_user_id = p_joiner_user_id then
    raise exception 'Cannot join your own invite.' using errcode = 'P0001';
  end if;

  if v_invite.creator_agent_id = p_joiner_agent_id then
    raise exception 'Cannot join your own invite.' using errcode = 'P0001';
  end if;

  if v_invite.created_by_user_id <> p_creator_user_id
    or v_invite.creator_agent_id <> p_creator_agent_id
    or v_invite.wager_usd is distinct from p_wager_usd
    or v_invite.duration_seconds is distinct from p_duration_seconds
    or v_invite.warmup_seconds is distinct from p_warmup_seconds
    or v_invite.starting_capital_usd is distinct from p_starting_capital_usd
  then
    raise exception 'Invite terms changed. Reload the invite and try again.' using errcode = 'P0001';
  end if;

  v_first_lock := least(v_invite.creator_agent_id::text, p_joiner_agent_id::text);
  v_second_lock := greatest(v_invite.creator_agent_id::text, p_joiner_agent_id::text);
  perform pg_advisory_xact_lock(hashtext(v_first_lock));
  if v_second_lock <> v_first_lock then
    perform pg_advisory_xact_lock(hashtext(v_second_lock));
  end if;

  if exists (
    select 1 from public.matches
    where (
      creator_agent_id = p_joiner_agent_id
      or opponent_agent_id = p_joiner_agent_id
    )
    and status in ('created', 'warmup', 'live', 'settling')
  ) then
    raise exception 'Joining agent already has an active match.' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.matches
    where (
      creator_agent_id = v_invite.creator_agent_id
      or opponent_agent_id = v_invite.creator_agent_id
    )
    and status in ('created', 'warmup', 'live', 'settling')
  ) then
    raise exception 'Creator agent already has an active match.' using errcode = 'P0001';
  end if;

  insert into public.matches (
    id,
    creator_user_id,
    creator_agent_id,
    creator_smart_account_address,
    opponent_user_id,
    opponent_agent_id,
    opponent_smart_account_address,
    status,
    wager_usd,
    live_duration_seconds,
    warmup_duration_seconds,
    settlement_grace_seconds,
    starting_capital_usd,
    result_summary,
    created_at,
    warmup_started_at,
    updated_at
  ) values (
    v_match_id,
    v_invite.created_by_user_id,
    v_invite.creator_agent_id,
    p_creator_smart_account_address,
    p_joiner_user_id,
    p_joiner_agent_id,
    p_joiner_smart_account_address,
    'warmup',
    v_invite.wager_usd,
    v_invite.duration_seconds,
    v_invite.warmup_seconds,
    15,
    v_invite.starting_capital_usd,
    '{}'::jsonb,
    v_now,
    v_now,
    v_now
  )
  returning * into v_match;

  update public.match_invites
  set
    status = 'joined',
    created_match_id = v_match_id,
    joiner_user_id = p_joiner_user_id,
    joiner_agent_id = p_joiner_agent_id,
    updated_at = v_now
  where id = p_invite_id;

  select v_match_id as match_id, 'warmup'::text as match_status into v_result;
  return v_result;
end;
$function$;
