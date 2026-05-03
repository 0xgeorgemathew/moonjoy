-- Enable Supabase Realtime for arena live data tables.
-- These tables already have authenticated user RLS SELECT policies
-- so Postgres Changes subscriptions work for match participants.
DO $$
DECLARE
  table_name text;
  realtime_tables text[] := ARRAY[
    'simulated_trades',
    'match_events',
    'portfolio_valuation_snapshots',
    'matches'
  ];
BEGIN
  FOREACH table_name IN ARRAY realtime_tables
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = table_name
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', table_name);
    END IF;
  END LOOP;
END
$$;
