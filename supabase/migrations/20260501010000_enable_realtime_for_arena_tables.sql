-- Enable Supabase Realtime for arena live data tables
-- These tables already have authenticated user RLS SELECT policies
-- so Postgres Changes subscriptions will work for match participants.

ALTER PUBLICATION supabase_realtime ADD TABLE public.simulated_trades;
ALTER PUBLICATION supabase_realtime ADD TABLE public.match_events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.portfolio_valuation_snapshots;
ALTER PUBLICATION supabase_realtime ADD TABLE public.matches;
