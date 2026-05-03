-- Phase 2: Arena enrichment — richer trade metadata, price snapshots, realtime

-- Add trade enrichment columns
ALTER TABLE simulated_trades
  ADD COLUMN IF NOT EXISTS pnl_delta_usd numeric,
  ADD COLUMN IF NOT EXISTS price_at_trade numeric,
  ADD COLUMN IF NOT EXISTS estimated_value_usd numeric,
  ADD COLUMN IF NOT EXISTS token_category text;

-- Token price snapshots for freshness tracking
CREATE TABLE IF NOT EXISTS token_price_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_address text NOT NULL,
  chain_id int NOT NULL DEFAULT 8453 CHECK (chain_id = 8453),
  price_usd numeric NOT NULL,
  source text NOT NULL DEFAULT 'uniswap' CHECK (source IN ('uniswap', 'dexscreener', 'coingecko')),
  source_metadata jsonb DEFAULT '{}',
  match_id uuid REFERENCES matches(id),
  fetched_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_token_price_snapshots_token ON token_price_snapshots (token_address, chain_id);
CREATE INDEX IF NOT EXISTS idx_token_price_snapshots_fetched ON token_price_snapshots (fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_token_price_snapshots_match ON token_price_snapshots (match_id);

CREATE INDEX IF NOT EXISTS idx_mandatory_window_results_agent
  ON mandatory_window_results (agent_id);

CREATE INDEX IF NOT EXISTS idx_match_token_allowlists_token
  ON match_token_allowlists (token_id);

CREATE INDEX IF NOT EXISTS idx_matches_invited_user
  ON matches (invited_user_id);

CREATE INDEX IF NOT EXISTS idx_matches_winner_agent
  ON matches (winner_agent_id);

CREATE INDEX IF NOT EXISTS idx_portfolio_ledger_entries_agent
  ON portfolio_ledger_entries (agent_id);

CREATE INDEX IF NOT EXISTS idx_portfolio_ledger_entries_trade
  ON portfolio_ledger_entries (trade_id);

CREATE INDEX IF NOT EXISTS idx_portfolio_valuation_snapshots_agent
  ON portfolio_valuation_snapshots (agent_id);

CREATE INDEX IF NOT EXISTS idx_simulated_trades_quote_snapshot
  ON simulated_trades (quote_snapshot_id);

CREATE INDEX IF NOT EXISTS idx_strategy_planning_messages_strategy
  ON strategy_planning_messages (strategy_id);

CREATE INDEX IF NOT EXISTS idx_strategy_planning_messages_user
  ON strategy_planning_messages (user_id);

ALTER TABLE token_price_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read token prices"
  ON token_price_snapshots FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role full access"
  ON token_price_snapshots FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- Enable Realtime for arena-critical tables.
DO $$
DECLARE
  table_name text;
  realtime_tables text[] := ARRAY[
    'match_token_allowlists',
    'token_universe_tokens',
    'token_discovery_snapshots',
    'mandatory_window_results',
    'token_price_snapshots'
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

-- Update accept_simulated_trade RPC to populate new columns
CREATE OR REPLACE FUNCTION accept_simulated_trade(
  p_trade_id uuid,
  p_match_id uuid,
  p_agent_id uuid,
  p_seat text,
  p_phase text,
  p_token_in text,
  p_token_out text,
  p_amount_in text,
  p_quoted_amount_out text,
  p_simulated_amount_out text,
  p_slippage_bps integer,
  p_quote_snapshot_id uuid,
  p_input_value_usd numeric,
  p_output_value_usd numeric,
  p_accepted_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_usdc_address text := '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
  v_current_usdc_balance text;
  v_resulting_usdc bigint;
  v_token_category text;
  v_price_at_trade numeric;
BEGIN
  SELECT risk_tier INTO v_token_category
  FROM token_universe_tokens
  WHERE lower(address) = lower(p_token_out) AND chain_id = 8453
  LIMIT 1;

  IF p_simulated_amount_out::numeric > 0 THEN
    v_price_at_trade := p_output_value_usd / (p_simulated_amount_out::numeric / power(10, COALESCE(
      (SELECT decimals FROM token_universe_tokens WHERE lower(address) = lower(p_token_out) AND chain_id = 8453 LIMIT 1),
      18
    )));
  ELSE
    v_price_at_trade := NULL;
  END IF;

  IF lower(p_token_in) <> v_usdc_address THEN
    INSERT INTO simulated_trades (
      id, match_id, agent_id, seat, phase, token_in, token_out,
      amount_in, quoted_amount_out, simulated_amount_out, slippage_bps,
      quote_snapshot_id, status, failure_reason, accepted_at,
      estimated_value_usd, token_category
    ) VALUES (
      p_trade_id, p_match_id, p_agent_id, p_seat, p_phase,
      lower(p_token_in), lower(p_token_out), p_amount_in, '0', '0', 0,
      NULL, 'rejected', 'MVP simulated trading only supports USDC as token_in.', p_accepted_at,
      p_output_value_usd, v_token_category
    );
    RETURN jsonb_build_object(
      'status', 'rejected',
      'reason', 'MVP simulated trading only supports USDC as token_in.',
      'retryable', false
    );
  END IF;

  SELECT COALESCE(
    SUM(
      CASE
        WHEN entry_type IN ('trade_credit', 'starting_balance') THEN amount_base_units::bigint
        WHEN entry_type = 'trade_debit' THEN -amount_base_units::bigint
        ELSE 0
      END
    ),
    0
  )::text INTO v_current_usdc_balance
  FROM portfolio_ledger_entries
  WHERE match_id = p_match_id
    AND agent_id = p_agent_id
    AND lower(token_address) = v_usdc_address;

  IF v_current_usdc_balance IS NULL THEN
    v_current_usdc_balance := '0';
  END IF;

  v_resulting_usdc := v_current_usdc_balance::bigint - p_amount_in::bigint;

  IF v_resulting_usdc < 0 THEN
    INSERT INTO simulated_trades (
      id, match_id, agent_id, seat, phase, token_in, token_out,
      amount_in, quoted_amount_out, simulated_amount_out, slippage_bps,
      quote_snapshot_id, status, failure_reason, accepted_at,
      estimated_value_usd, token_category
    ) VALUES (
      p_trade_id, p_match_id, p_agent_id, p_seat, p_phase,
      p_token_in, p_token_out, p_amount_in, '0', '0', 0,
      NULL, 'rejected', 'Insufficient USDC balance for atomic trade.', p_accepted_at,
      p_output_value_usd, v_token_category
    );
    RETURN jsonb_build_object('status', 'rejected', 'reason', 'Insufficient USDC balance for atomic trade.');
  END IF;

  INSERT INTO simulated_trades (
    id, match_id, agent_id, seat, phase, token_in, token_out,
    amount_in, quoted_amount_out, simulated_amount_out, slippage_bps,
    quote_snapshot_id, status, accepted_at,
    estimated_value_usd, price_at_trade, token_category
  ) VALUES (
    p_trade_id, p_match_id, p_agent_id, p_seat, p_phase,
    p_token_in, p_token_out, p_amount_in, p_quoted_amount_out,
    p_simulated_amount_out, p_slippage_bps, p_quote_snapshot_id,
    'accepted', p_accepted_at,
    p_output_value_usd, v_price_at_trade, v_token_category
  );

  INSERT INTO portfolio_ledger_entries (
    id, match_id, agent_id, trade_id, entry_type,
    token_address, amount_base_units, value_usd, metadata
  ) VALUES (
    gen_random_uuid(), p_match_id, p_agent_id, p_trade_id, 'trade_debit',
    lower(p_token_in), p_amount_in, p_input_value_usd, jsonb_build_object('tradeId', p_trade_id)
  );

  INSERT INTO portfolio_ledger_entries (
    id, match_id, agent_id, trade_id, entry_type,
    token_address, amount_base_units, value_usd, metadata
  ) VALUES (
    gen_random_uuid(), p_match_id, p_agent_id, p_trade_id, 'trade_credit',
    lower(p_token_out), p_simulated_amount_out, p_output_value_usd, jsonb_build_object('tradeId', p_trade_id)
  );

  INSERT INTO match_events (match_id, event_type, payload)
  VALUES (
    p_match_id,
    'trade_accepted',
    jsonb_build_object(
      'tradeId', p_trade_id,
      'agentId', p_agent_id,
      'seat', p_seat,
      'tokenIn', lower(p_token_in),
      'tokenOut', lower(p_token_out),
      'amountIn', p_amount_in,
      'simulatedAmountOut', p_simulated_amount_out,
      'inputValueUsd', p_input_value_usd,
      'outputValueUsd', p_output_value_usd,
      'estimatedValueUsd', p_output_value_usd,
      'tokenCategory', v_token_category
    )
  );

  RETURN jsonb_build_object('status', 'accepted', 'tradeId', p_trade_id);
END;
$$;

ALTER FUNCTION accept_simulated_trade SET search_path = public;
