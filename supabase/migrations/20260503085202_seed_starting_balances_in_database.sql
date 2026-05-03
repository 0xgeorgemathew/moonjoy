-- Make simulated starting capital a database invariant.
--
-- App services still seed defensively, but any match that reaches live or
-- settling must have one USDC starting_balance row per participant before
-- trades can debit USDC.

create or replace function public.ensure_match_starting_balances(
  p_match_id uuid,
  p_usdc_address text default '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
) returns void
language plpgsql
set search_path = public
as $$
declare
  v_match public.matches%rowtype;
  v_amount_base_units numeric;
  v_agent_id uuid;
begin
  select *
  into v_match
  from public.matches
  where id = p_match_id;

  if not found then
    raise exception 'Match not found for starting balance initialization.'
      using errcode = '23503';
  end if;

  if v_match.opponent_agent_id is null then
    return;
  end if;

  if v_match.starting_capital_usd is null or v_match.starting_capital_usd <= 0 then
    raise exception 'Starting capital must be greater than zero.'
      using errcode = '23514';
  end if;

  v_amount_base_units := round(v_match.starting_capital_usd * 1000000);

  foreach v_agent_id in array array[v_match.creator_agent_id, v_match.opponent_agent_id]
  loop
    begin
      insert into public.portfolio_ledger_entries (
        match_id,
        agent_id,
        entry_type,
        token_address,
        amount_base_units,
        value_usd,
        metadata
      )
      select
        p_match_id,
        v_agent_id,
        'starting_balance',
        lower(p_usdc_address),
        v_amount_base_units::text,
        v_match.starting_capital_usd,
        jsonb_build_object('source', 'match_start_database')
      where v_agent_id is not null
        and not exists (
          select 1
          from public.portfolio_ledger_entries existing
          where existing.match_id = p_match_id
            and existing.agent_id = v_agent_id
            and existing.entry_type = 'starting_balance'
        );
    exception
      when unique_violation then
        null;
    end;
  end loop;
end;
$$;

create or replace function public.ensure_starting_balances_after_match_live()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status in ('live', 'settling') then
    perform public.ensure_match_starting_balances(new.id);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_ensure_starting_balances_after_match_live
  on public.matches;

create trigger trg_ensure_starting_balances_after_match_live
  after insert or update of status, opponent_agent_id
  on public.matches
  for each row
  when (new.status in ('live', 'settling'))
  execute function public.ensure_starting_balances_after_match_live();

-- Existing duplicate penalty ledger rows were caused by racing workers: the
-- mandatory window result insert was unique, but the penalty ledger insert was
-- not gated on that insert succeeding. Keep the earliest row for each window.
with ranked_penalties as (
  select
    id,
    row_number() over (
      partition by match_id, agent_id, metadata->>'windowName'
      order by created_at asc, id asc
    ) as row_number
  from public.portfolio_ledger_entries
  where entry_type = 'penalty'
    and metadata ? 'windowName'
)
delete from public.portfolio_ledger_entries entries
using ranked_penalties ranked
where entries.id = ranked.id
  and ranked.row_number > 1;

create unique index if not exists idx_portfolio_ledger_single_penalty_window
  on public.portfolio_ledger_entries (match_id, agent_id, (metadata->>'windowName'))
  where entry_type = 'penalty';

revoke execute on function public.ensure_match_starting_balances(uuid, text)
  from anon, authenticated, public;
grant execute on function public.ensure_match_starting_balances(uuid, text)
  to service_role;
