alter table strategies
  add column if not exists strategy_kind text not null default 'public';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'strategies_strategy_kind_check'
      and conrelid = 'public.strategies'::regclass
  ) then
    alter table strategies
      add constraint strategies_strategy_kind_check
      check (strategy_kind in ('public', 'secret_sauce'));
  end if;
end
$$;

drop index if exists idx_strategies_one_active_per_agent;

create unique index if not exists idx_strategies_one_active_per_agent_kind
  on strategies(agent_id, strategy_kind)
  where status = 'active';
