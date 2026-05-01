-- Phase 1+2: Reconcile match_invites with remote, harden constraints, add invite RPCs
-- Idempotent: uses IF NOT EXISTS patterns for indexes and constraints

-- ============================================================
-- Phase 1: Reconcile + Harden match_invites
-- ============================================================

-- Add missing check constraints (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'match_invites_scope_ens_requires_name'
  ) THEN
    ALTER TABLE public.match_invites
      ADD CONSTRAINT match_invites_scope_ens_requires_name
      CHECK (
        (scope_type = 'open' AND scoped_ens_name IS NULL)
        OR (scope_type = 'ens' AND scoped_ens_name IS NOT NULL AND scoped_ens_name <> '')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'match_invites_wager_positive'
  ) THEN
    ALTER TABLE public.match_invites
      ADD CONSTRAINT match_invites_wager_positive
      CHECK (wager_usd > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'match_invites_duration_positive'
  ) THEN
    ALTER TABLE public.match_invites
      ADD CONSTRAINT match_invites_duration_positive
      CHECK (duration_seconds > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'match_invites_warmup_nonneg'
  ) THEN
    ALTER TABLE public.match_invites
      ADD CONSTRAINT match_invites_warmup_nonneg
      CHECK (warmup_seconds >= 0);
  END IF;
END
$$;

-- Add missing indexes (idempotent)
CREATE INDEX IF NOT EXISTS idx_match_invites_creator_agent_id
  ON public.match_invites (creator_agent_id);

CREATE INDEX IF NOT EXISTS idx_match_invites_joiner_user_id
  ON public.match_invites (joiner_user_id);

CREATE INDEX IF NOT EXISTS idx_match_invites_joiner_agent_id
  ON public.match_invites (joiner_agent_id);

CREATE INDEX IF NOT EXISTS idx_match_invites_created_match_id
  ON public.match_invites (created_match_id);

CREATE INDEX IF NOT EXISTS idx_match_invites_scoped_ens_status
  ON public.match_invites (scoped_ens_name, status)
  WHERE scoped_ens_name IS NOT NULL;

-- Tighten RLS: service-role-only access, no public browsing
-- Drop overly permissive policies if they exist, then set minimal policy
ALTER TABLE public.match_invites ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE tablename = 'match_invites' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.match_invites', pol.policyname);
  END LOOP;
END
$$;

-- Only service role can access match_invites directly
-- App routes use admin client, so no anon/authenticated policy needed
CREATE POLICY "match_invites_service_role_only" ON public.match_invites
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Mark old match invite columns as deprecated (do not remove yet)
COMMENT ON COLUMN public.matches.invited_user_id IS 'DEPRECATED: Use match_invites table instead.';
COMMENT ON COLUMN public.matches.invite_code IS 'DEPRECATED: Use match_invites table instead.';

-- ============================================================
-- Phase 2: Invite RPCs
-- ============================================================

-- create_match_invite: atomically create an invite row with active-match guard
CREATE OR REPLACE FUNCTION public.create_match_invite(
  p_created_by_user_id uuid,
  p_creator_agent_id uuid,
  p_scope_type text,
  p_scoped_ens_name text,
  p_wager_usd numeric DEFAULT 10,
  p_duration_seconds integer DEFAULT 300,
  p_warmup_seconds integer DEFAULT 30,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS public.match_invites
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_invite public.match_invites;
begin
  -- Lock creator agent to prevent concurrent invite/match creation
  perform pg_advisory_xact_lock(hashtext(p_creator_agent_id::text));

  -- Ensure creator has no active match or open invite
  if exists (
    select 1 from public.matches
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
    select 1 from public.match_invites
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
    'open',
    p_expires_at
  )
  returning * into v_invite;

  return v_invite;
end;
$function$;

-- join_match_invite: atomically join invite, create warmup match
CREATE OR REPLACE FUNCTION public.join_match_invite(
  p_invite_id uuid,
  p_joiner_user_id uuid,
  p_joiner_agent_id uuid,
  p_joiner_smart_account_address text,
  p_creator_user_id uuid,
  p_creator_agent_id uuid,
  p_creator_smart_account_address text,
  p_wager_usd numeric DEFAULT 10,
  p_duration_seconds integer DEFAULT 300,
  p_warmup_seconds integer DEFAULT 30
)
RETURNS record
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- Lock invite row
  select * into v_invite
  from public.match_invites
  where id = p_invite_id
  for update;

  if not found then
    raise exception 'Invite not found.' using errcode = 'P0001';
  end if;

  -- Validate invite state
  if v_invite.status != 'open' then
    raise exception 'Invite is no longer open: status=%', v_invite.status using errcode = 'P0001';
  end if;

  if v_invite.expires_at is not null and v_now > v_invite.expires_at then
    update public.match_invites set status = 'expired', updated_at = v_now where id = p_invite_id;
    raise exception 'Invite has expired.' using errcode = 'P0001';
  end if;

  -- Reject self-join
  if v_invite.created_by_user_id = p_joiner_user_id then
    raise exception 'Cannot join your own invite.' using errcode = 'P0001';
  end if;

  if v_invite.creator_agent_id = p_joiner_agent_id then
    raise exception 'Cannot join your own invite.' using errcode = 'P0001';
  end if;

  -- Lock both agents in deterministic order
  v_first_lock := least(v_invite.creator_agent_id::text, p_joiner_agent_id::text);
  v_second_lock := greatest(v_invite.creator_agent_id::text, p_joiner_agent_id::text);
  perform pg_advisory_xact_lock(hashtext(v_first_lock));
  if v_second_lock <> v_first_lock then
    perform pg_advisory_xact_lock(hashtext(v_second_lock));
  end if;

  -- Ensure neither agent has an active match
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

  -- Create match in warmup state
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
    p_creator_user_id,
    p_creator_agent_id,
    p_creator_smart_account_address,
    p_joiner_user_id,
    p_joiner_agent_id,
    p_joiner_smart_account_address,
    'warmup',
    p_wager_usd,
    p_duration_seconds,
    p_warmup_seconds,
    15,
    100,
    '{}'::jsonb,
    v_now,
    v_now,
    v_now
  )
  returning * into v_match;

  -- Mark invite joined
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
