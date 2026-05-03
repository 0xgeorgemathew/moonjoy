-- Keep the bidirectional trading schema clean under Supabase advisors.

alter function public.classify_trade_side(text, text, text)
  set search_path = public;

drop policy if exists "Users can read own portfolio lots" on public.portfolio_lots;

create policy "Users can read own portfolio lots"
  on public.portfolio_lots
  for select
  to authenticated
  using (
    match_id in (
      select public.matches.id
      from public.matches
      where public.matches.creator_user_id in (
        select public.users.id
        from public.users
        where public.users.privy_user_id = ((select auth.jwt()) ->> 'sub')
      )
      or public.matches.opponent_user_id in (
        select public.users.id
        from public.users
        where public.users.privy_user_id = ((select auth.jwt()) ->> 'sub')
      )
    )
  );

drop policy if exists "Users can read own lot closures" on public.portfolio_lot_closures;

create policy "Users can read own lot closures"
  on public.portfolio_lot_closures
  for select
  to authenticated
  using (
    match_id in (
      select public.matches.id
      from public.matches
      where public.matches.creator_user_id in (
        select public.users.id
        from public.users
        where public.users.privy_user_id = ((select auth.jwt()) ->> 'sub')
      )
      or public.matches.opponent_user_id in (
        select public.users.id
        from public.users
        where public.users.privy_user_id = ((select auth.jwt()) ->> 'sub')
      )
    )
  );

create index if not exists idx_portfolio_lots_agent
  on public.portfolio_lots (agent_id);

create index if not exists idx_portfolio_lot_closures_agent
  on public.portfolio_lot_closures (agent_id);
