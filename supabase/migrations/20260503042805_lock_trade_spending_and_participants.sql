-- Prevent concurrent simulated fills from spending the same pre-trade balance.
--
-- The trade RPCs already check balances, but under read-committed isolation two
-- concurrent calls can both pass that check before either ledger debit is
-- visible. Serialize accepted trade writes per match/agent and keep a ledger
-- trigger as the canonical non-negative balance backstop.

do $$
declare
  v_function_sql text;
  v_next_sql text;
begin
  select pg_get_functiondef(
    'public.accept_simulated_trade(uuid,uuid,uuid,text,text,text,text,text,text,text,integer,uuid,numeric,numeric,timestamp with time zone)'::regprocedure
  )
  into v_function_sql;

  if position('pg_advisory_xact_lock' in v_function_sql) = 0 then
    v_next_sql := replace(
      v_function_sql,
      'BEGIN
  -- Compute current USDC balance for this agent/match',
      'BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(''trade:'' || p_match_id::text || '':'' || p_agent_id::text, 0));

  -- Compute current USDC balance for this agent/match'
    );

    if v_next_sql = v_function_sql then
      v_next_sql := replace(
        v_function_sql,
        'BEGIN
  -- Look up token category for output token',
        'BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(''trade:'' || p_match_id::text || '':'' || p_agent_id::text, 0));

  -- Look up token category for output token'
      );
    end if;

    if v_next_sql = v_function_sql then
      raise exception 'Could not patch accept_simulated_trade with trade lock.';
    end if;

    execute v_next_sql;
  end if;
end
$$;

do $$
declare
  v_function_sql text;
  v_next_sql text;
begin
  select pg_get_functiondef(
    'public.accept_bidirectional_trade(uuid,uuid,uuid,text,text,text,text,text,text,text,integer,uuid,numeric,numeric,timestamp with time zone,text,text)'::regprocedure
  )
  into v_function_sql;

  if position('pg_advisory_xact_lock' in v_function_sql) = 0 then
    v_next_sql := replace(
      v_function_sql,
      'BEGIN
  -- Get match trade rules version',
      'BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(''trade:'' || p_match_id::text || '':'' || p_agent_id::text, 0));

  -- Get match trade rules version'
    );

    if v_next_sql = v_function_sql then
      raise exception 'Could not patch accept_bidirectional_trade with trade lock.';
    end if;

    execute v_next_sql;
  end if;
end
$$;

create or replace function public.enforce_simulated_trade_match_participant()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_creator_agent_id uuid;
  v_opponent_agent_id uuid;
begin
  select creator_agent_id, opponent_agent_id
  into v_creator_agent_id, v_opponent_agent_id
  from public.matches
  where id = new.match_id;

  if new.seat = 'creator' and new.agent_id is distinct from v_creator_agent_id then
    raise exception 'Trade creator seat does not match match creator agent.'
      using errcode = '23514';
  end if;

  if new.seat = 'opponent' and new.agent_id is distinct from v_opponent_agent_id then
    raise exception 'Trade opponent seat does not match match opponent agent.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_simulated_trade_match_participant
  on public.simulated_trades;

create trigger trg_enforce_simulated_trade_match_participant
  before insert or update of match_id, agent_id, seat
  on public.simulated_trades
  for each row
  execute function public.enforce_simulated_trade_match_participant();

create or replace function public.enforce_nonnegative_trade_debit_balance()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_current_balance numeric;
  v_amount numeric;
begin
  if new.token_address is null or new.amount_base_units is null then
    return new;
  end if;

  v_amount := new.amount_base_units::numeric;
  if v_amount <= 0 then
    raise exception 'Ledger token amount must be positive.'
      using errcode = '23514';
  end if;

  if new.entry_type <> 'trade_debit' then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('trade:' || new.match_id::text || ':' || new.agent_id::text, 0));

  select coalesce(sum(
    case
      when entry_type in ('starting_balance', 'trade_credit') then amount_base_units::numeric
      when entry_type = 'trade_debit' then -amount_base_units::numeric
      else 0
    end
  ), 0)
  into v_current_balance
  from public.portfolio_ledger_entries
  where match_id = new.match_id
    and agent_id = new.agent_id
    and lower(token_address) = lower(new.token_address);

  if v_current_balance < v_amount then
    raise exception 'Insufficient portfolio balance for trade debit.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_nonnegative_trade_debit_balance
  on public.portfolio_ledger_entries;

create trigger trg_enforce_nonnegative_trade_debit_balance
  before insert
  on public.portfolio_ledger_entries
  for each row
  execute function public.enforce_nonnegative_trade_debit_balance();
