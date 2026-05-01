-- Add invite columns to matches for ENS-scoped and direct invite matchmaking
-- Reconstructed from remote schema

alter table public.matches
  add column if not exists invited_user_id uuid references public.users(id) on delete set null,
  add column if not exists invite_code text;

create index if not exists idx_matches_invited_user_open
  on public.matches (invited_user_id, created_at desc)
  where status = 'created' and opponent_agent_id is null;
