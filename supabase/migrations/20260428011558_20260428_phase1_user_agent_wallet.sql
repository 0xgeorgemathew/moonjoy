create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'users') then
    create table users (
      id uuid primary key default gen_random_uuid(),
      privy_user_id text not null unique,
      embedded_signer_address text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  else
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'privy_user_id') then
      alter table users add column privy_user_id text;
    end if;
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'embedded_signer_address') then
      alter table users add column embedded_signer_address text;
    end if;
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'created_at') then
      alter table users add column created_at timestamptz not null default now();
    end if;
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'updated_at') then
      alter table users add column updated_at timestamptz not null default now();
    end if;
  end if;
end
$$;

create unique index if not exists idx_users_privy_user_id_unique
  on users(privy_user_id);

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'agents') then
    create table agents (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references users(id) on delete cascade,
      smart_account_address text,
      setup_status text not null default 'incomplete',
      status text not null default 'active',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint agents_setup_status_check check (setup_status in ('incomplete', 'wallet_created')),
      constraint agents_status_check check (status in ('active', 'paused', 'revoked'))
    );
  else
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'agents' and column_name = 'smart_account_address') then
      alter table agents add column smart_account_address text;
    end if;
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'agents' and column_name = 'setup_status') then
      alter table agents add column setup_status text not null default 'incomplete';
    end if;
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'agents' and column_name = 'status') then
      alter table agents add column status text not null default 'active';
    end if;
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'agents' and column_name = 'created_at') then
      alter table agents add column created_at timestamptz not null default now();
    end if;
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'agents' and column_name = 'updated_at') then
      alter table agents add column updated_at timestamptz not null default now();
    end if;
    if not exists (select 1 from pg_constraint where conname = 'agents_setup_status_check' and conrelid = 'public.agents'::regclass) then
      alter table agents add constraint agents_setup_status_check check (setup_status in ('incomplete', 'wallet_created'));
    end if;
    if not exists (select 1 from pg_constraint where conname = 'agents_status_check' and conrelid = 'public.agents'::regclass) then
      alter table agents add constraint agents_status_check check (status in ('active', 'paused', 'revoked'));
    end if;
  end if;
end
$$;

create unique index if not exists idx_agents_one_active_per_user
  on agents(user_id)
  where status = 'active';

create unique index if not exists idx_agents_smart_account_address_unique
  on agents(lower(smart_account_address))
  where smart_account_address is not null;

create index if not exists idx_users_embedded_signer_address
  on users(lower(embedded_signer_address))
  where embedded_signer_address is not null;

create index if not exists idx_agents_setup_status on agents(setup_status);

alter table users enable row level security;
alter table agents enable row level security;

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
