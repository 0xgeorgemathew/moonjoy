-- Covers Arena foreign keys flagged by Supabase's performance advisor.
-- Kept separate so already-deployed databases can converge without replaying
-- the full arena enrichment migration.
CREATE INDEX IF NOT EXISTS idx_token_price_snapshots_match
  ON public.token_price_snapshots (match_id);

CREATE INDEX IF NOT EXISTS idx_mandatory_window_results_agent
  ON public.mandatory_window_results (agent_id);

CREATE INDEX IF NOT EXISTS idx_match_token_allowlists_token
  ON public.match_token_allowlists (token_id);

CREATE INDEX IF NOT EXISTS idx_matches_invited_user
  ON public.matches (invited_user_id);

CREATE INDEX IF NOT EXISTS idx_matches_winner_agent
  ON public.matches (winner_agent_id);

CREATE INDEX IF NOT EXISTS idx_portfolio_ledger_entries_agent
  ON public.portfolio_ledger_entries (agent_id);

CREATE INDEX IF NOT EXISTS idx_portfolio_ledger_entries_trade
  ON public.portfolio_ledger_entries (trade_id);

CREATE INDEX IF NOT EXISTS idx_portfolio_valuation_snapshots_agent
  ON public.portfolio_valuation_snapshots (agent_id);

CREATE INDEX IF NOT EXISTS idx_simulated_trades_quote_snapshot
  ON public.simulated_trades (quote_snapshot_id);

CREATE INDEX IF NOT EXISTS idx_strategy_planning_messages_strategy
  ON public.strategy_planning_messages (strategy_id);

CREATE INDEX IF NOT EXISTS idx_strategy_planning_messages_user
  ON public.strategy_planning_messages (user_id);
