drop event trigger if exists ensure_rls;
drop function if exists confirm_ens_claim(uuid, uuid, text, text);
drop function if exists rls_auto_enable();

drop table if exists ens_text_records;
drop table if exists ens_claims;

alter table users drop column if exists ens_name;
alter table agents drop column if exists ens_name;

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
