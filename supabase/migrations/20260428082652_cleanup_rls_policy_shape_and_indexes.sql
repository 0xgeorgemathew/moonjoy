drop policy if exists "Users can read own row" on users;
drop policy if exists "Users can update own row" on users;
drop policy if exists "Users can read own agents" on agents;

create policy "Users can read own row"
  on users for select
  to authenticated
  using (((select auth.jwt()) ->> 'sub') = privy_user_id);

create policy "Users can update own row"
  on users for update
  to authenticated
  using (((select auth.jwt()) ->> 'sub') = privy_user_id)
  with check (((select auth.jwt()) ->> 'sub') = privy_user_id);

create policy "Users can read own agents"
  on agents for select
  to authenticated
  using (user_id in (
    select id from users where privy_user_id = ((select auth.jwt()) ->> 'sub')
  ));

drop index if exists idx_users_embedded_signer_address;
drop index if exists idx_agents_setup_status;
