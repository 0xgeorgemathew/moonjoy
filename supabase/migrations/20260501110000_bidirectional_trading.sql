-- Bidirectional Trading: Buy, Sell, Swap with Lot-Based FIFO PnL Tracking
-- Phase: Add lot tracking, trade sides, realized PnL, and v2 trading rules

-- ============================================================
-- 1. Add trade rules version to matches (for backwards compatibility)
-- ============================================================

ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS trade_rules_version text
  NOT NULL DEFAULT 'buy_only_v1'
  CHECK (trade_rules_version IN ('buy_only_v1', 'bidirectional_v2'));

-- Existing rows keep the backfilled buy_only_v1 value. New matches should
-- opt into bidirectional rules unless application code says otherwise.
ALTER TABLE matches
  ALTER COLUMN trade_rules_version SET DEFAULT 'bidirectional_v2';

-- Index for querying matches by rules version
CREATE INDEX IF NOT EXISTS idx_matches_trade_rules_version
  ON matches (trade_rules_version)
  WHERE trade_rules_version = 'bidirectional_v2';

-- ============================================================
-- 2. Portfolio lots table (FIFO position tracking)
-- ============================================================

CREATE TABLE IF NOT EXISTS portfolio_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  token_address text NOT NULL,
  acquired_amount_base_units text NOT NULL,
  remaining_amount_base_units text NOT NULL,
  cost_basis_usd numeric NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  source_trade_id uuid REFERENCES simulated_trades(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  closed_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE portfolio_lots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to portfolio_lots"
  ON portfolio_lots FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Users can read own portfolio lots"
  ON portfolio_lots FOR SELECT
  TO authenticated
  USING (
    match_id IN (
      SELECT matches.id FROM public.matches
      WHERE
        matches.creator_user_id IN (
          SELECT users.id FROM public.users
          WHERE users.privy_user_id = auth.jwt() ->> 'sub'
        )
        OR matches.opponent_user_id IN (
          SELECT users.id FROM public.users
          WHERE users.privy_user_id = auth.jwt() ->> 'sub'
        )
    )
  );

-- Indexes for lot queries
CREATE INDEX IF NOT EXISTS idx_portfolio_lots_match_agent
  ON portfolio_lots (match_id, agent_id);

CREATE INDEX IF NOT EXISTS idx_portfolio_lots_token
  ON portfolio_lots (token_address);

CREATE INDEX IF NOT EXISTS idx_portfolio_lots_open
  ON portfolio_lots (match_id, agent_id, token_address)
  WHERE closed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_portfolio_lots_source_trade
  ON portfolio_lots (source_trade_id);

-- ============================================================
-- 3. Portfolio lot closures table (audit trail for FIFO)
-- ============================================================

CREATE TABLE IF NOT EXISTS portfolio_lot_closures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  token_address text NOT NULL,
  trade_id uuid NOT NULL REFERENCES simulated_trades(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  lot_id uuid NOT NULL REFERENCES portfolio_lots(id) ON DELETE CASCADE,
  amount_closed_base_units text NOT NULL,
  cost_basis_closed_usd numeric NOT NULL,
  proceeds_usd numeric NOT NULL,
  realized_pnl_usd numeric NOT NULL,
  closed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE portfolio_lot_closures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to portfolio_lot_closures"
  ON portfolio_lot_closures FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Users can read own lot closures"
  ON portfolio_lot_closures FOR SELECT
  TO authenticated
  USING (
    match_id IN (
      SELECT matches.id FROM public.matches
      WHERE
        matches.creator_user_id IN (
          SELECT users.id FROM public.users
          WHERE users.privy_user_id = auth.jwt() ->> 'sub'
        )
        OR matches.opponent_user_id IN (
          SELECT users.id FROM public.users
          WHERE users.privy_user_id = auth.jwt() ->> 'sub'
        )
    )
  );

-- Indexes for closure queries
CREATE INDEX IF NOT EXISTS idx_portfolio_lot_closures_match_agent
  ON portfolio_lot_closures (match_id, agent_id);

CREATE INDEX IF NOT EXISTS idx_portfolio_lot_closures_trade
  ON portfolio_lot_closures (trade_id);

CREATE INDEX IF NOT EXISTS idx_portfolio_lot_closures_lot
  ON portfolio_lot_closures (lot_id);

-- ============================================================
-- 4. Enrich simulated_trades with bidirectional metadata
-- ============================================================

-- Trade side classification
ALTER TABLE simulated_trades
  ADD COLUMN IF NOT EXISTS trade_side text
  CHECK (trade_side IN ('buy', 'sell', 'swap', 'exit'));

-- Realized PnL tracking
ALTER TABLE simulated_trades
  ADD COLUMN IF NOT EXISTS realized_pnl_usd numeric;

ALTER TABLE simulated_trades
  ADD COLUMN IF NOT EXISTS closed_cost_basis_usd numeric;

-- Input/output value for PnL calculation
ALTER TABLE simulated_trades
  ADD COLUMN IF NOT EXISTS input_value_usd numeric;

ALTER TABLE simulated_trades
  ADD COLUMN IF NOT EXISTS output_value_usd numeric;

-- Trade retryability flag
ALTER TABLE simulated_trades
  ADD COLUMN IF NOT EXISTS retryable boolean NOT NULL DEFAULT true;

-- ============================================================
-- 5. accept_bidirectional_trade RPC
-- ============================================================

CREATE OR REPLACE FUNCTION accept_bidirectional_trade(
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
  p_accepted_at timestamptz,
  p_trade_side text,
  p_usdc_address text DEFAULT '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_trade_rules_version text;
  v_token_category text;
  v_price_at_trade numeric;
  v_token_in_decimals integer;
  v_token_out_decimals integer;
  v_realized_pnl_usd numeric := 0;
  v_closed_cost_basis_usd numeric := 0;
  v_is_sell boolean;
  v_is_swap boolean;
  v_current_lot RECORD;
  v_remaining_to_close numeric;
  v_lot_close_amount numeric;
  v_lot_cost_basis numeric;
  v_lot_proceeds numeric;
  v_lot_realized_pnl numeric;
  v_token_balance text;
  v_open_lot_balance numeric;
BEGIN
  -- Get match trade rules version
  SELECT trade_rules_version INTO v_trade_rules_version
  FROM matches
  WHERE id = p_match_id;

  IF v_trade_rules_version IS NULL THEN
    v_trade_rules_version := 'buy_only_v1';
  END IF;

  -- For v1 matches, reject non-USDC tokenIn
  IF v_trade_rules_version = 'buy_only_v1' THEN
    IF lower(p_token_in) <> lower(p_usdc_address) THEN
      INSERT INTO simulated_trades (
        id, match_id, agent_id, seat, phase, token_in, token_out,
        amount_in, quoted_amount_out, simulated_amount_out, slippage_bps,
        quote_snapshot_id, status, failure_reason, accepted_at,
        trade_side, input_value_usd, output_value_usd, retryable
      ) VALUES (
        p_trade_id, p_match_id, p_agent_id, p_seat, p_phase,
        lower(p_token_in), lower(p_token_out), p_amount_in, '0', '0', 0,
        NULL, 'rejected', 'Buy-only v1 match: only USDC as token_in is allowed.', p_accepted_at,
        p_trade_side, p_input_value_usd, p_output_value_usd, false
      );
      RETURN jsonb_build_object(
        'status', 'rejected',
        'reason', 'Buy-only v1 match: only USDC as token_in is allowed.',
        'retryable', false
      );
    END IF;
  END IF;

  -- Reject USDC -> USDC as invalid
  IF lower(p_token_in) = lower(p_usdc_address) AND lower(p_token_out) = lower(p_usdc_address) THEN
    INSERT INTO simulated_trades (
      id, match_id, agent_id, seat, phase, token_in, token_out,
      amount_in, quoted_amount_out, simulated_amount_out, slippage_bps,
      quote_snapshot_id, status, failure_reason, accepted_at,
      trade_side, input_value_usd, output_value_usd, retryable
    ) VALUES (
      p_trade_id, p_match_id, p_agent_id, p_seat, p_phase,
      lower(p_token_in), lower(p_token_out), p_amount_in, '0', '0', 0,
      NULL, 'rejected', 'Invalid trade: USDC to USDC is not allowed.', p_accepted_at,
      p_trade_side, p_input_value_usd, p_output_value_usd, false
    );
    RETURN jsonb_build_object(
      'status', 'rejected',
      'reason', 'Invalid trade: USDC to USDC is not allowed.',
      'retryable', false
    );
  END IF;

  -- Determine if this is a sell or swap
  v_is_sell := (lower(p_token_in) <> lower(p_usdc_address) AND lower(p_token_out) = lower(p_usdc_address));
  v_is_swap := (lower(p_token_in) <> lower(p_usdc_address) AND lower(p_token_out) <> lower(p_usdc_address));

  -- Atomically verify the tokenIn ledger balance for every accepted trade.
  SELECT COALESCE(SUM(
    CASE
      WHEN entry_type IN ('trade_credit', 'starting_balance') THEN amount_base_units::numeric
      WHEN entry_type = 'trade_debit' THEN -amount_base_units::numeric
      ELSE 0
    END
  ), 0)::text INTO v_token_balance
  FROM portfolio_ledger_entries
  WHERE match_id = p_match_id
    AND agent_id = p_agent_id
    AND lower(token_address) = lower(p_token_in);

  IF v_token_balance IS NULL THEN
    v_token_balance := '0';
  END IF;

  IF v_token_balance::numeric < p_amount_in::numeric THEN
    INSERT INTO simulated_trades (
      id, match_id, agent_id, seat, phase, token_in, token_out,
      amount_in, quoted_amount_out, simulated_amount_out, slippage_bps,
      quote_snapshot_id, status, failure_reason, accepted_at,
      trade_side, input_value_usd, output_value_usd, retryable
    ) VALUES (
      p_trade_id, p_match_id, p_agent_id, p_seat, p_phase,
      lower(p_token_in), lower(p_token_out), p_amount_in, '0', '0', 0,
      NULL, 'rejected', 'Insufficient tokenIn balance for atomic trade.', p_accepted_at,
      p_trade_side, p_input_value_usd, p_output_value_usd, false
    );
    RETURN jsonb_build_object(
      'status', 'rejected',
      'reason', 'Insufficient tokenIn balance for atomic trade.',
      'retryable', false
    );
  END IF;

  -- Get token decimals for price calculation
  SELECT COALESCE(
    (SELECT decimals FROM token_universe_tokens WHERE lower(address) = lower(p_token_out) AND chain_id = 8453 LIMIT 1),
    18
  ) INTO v_token_out_decimals;

  IF p_simulated_amount_out::numeric > 0 THEN
    v_price_at_trade := p_output_value_usd / (p_simulated_amount_out::numeric / power(10, v_token_out_decimals));
  ELSE
    v_price_at_trade := NULL;
  END IF;

  -- Get token category for output token
  SELECT risk_tier INTO v_token_category
  FROM token_universe_tokens
  WHERE lower(address) = lower(p_token_out) AND chain_id = 8453
  LIMIT 1;

  -- For v2 matches: if sell or swap, close lots FIFO and compute realized PnL
  IF v_trade_rules_version = 'bidirectional_v2' AND (v_is_sell OR v_is_swap) THEN
    SELECT COALESCE(SUM(remaining_amount_base_units::numeric), 0)
    INTO v_open_lot_balance
    FROM portfolio_lots
    WHERE match_id = p_match_id
      AND agent_id = p_agent_id
      AND lower(token_address) = lower(p_token_in)
      AND closed_at IS NULL;

    IF v_open_lot_balance < p_amount_in::numeric THEN
      INSERT INTO simulated_trades (
        id, match_id, agent_id, seat, phase, token_in, token_out,
        amount_in, quoted_amount_out, simulated_amount_out, slippage_bps,
        quote_snapshot_id, status, failure_reason, accepted_at,
        trade_side, input_value_usd, output_value_usd, retryable
      ) VALUES (
        p_trade_id, p_match_id, p_agent_id, p_seat, p_phase,
        lower(p_token_in), lower(p_token_out), p_amount_in, '0', '0', 0,
        NULL, 'rejected', 'Insufficient lot balance for sell/swap accounting.', p_accepted_at,
        p_trade_side, p_input_value_usd, p_output_value_usd, false
      );
      RETURN jsonb_build_object(
        'status', 'rejected',
        'reason', 'Insufficient lot balance for sell/swap accounting.',
        'retryable', false
      );
    END IF;

    -- Close lots FIFO
    v_remaining_to_close := p_amount_in::numeric;

    FOR v_current_lot IN
      SELECT id, acquired_amount_base_units, remaining_amount_base_units, cost_basis_usd
      FROM portfolio_lots
      WHERE match_id = p_match_id
        AND agent_id = p_agent_id
        AND lower(token_address) = lower(p_token_in)
        AND closed_at IS NULL
      ORDER BY acquired_at ASC
    LOOP
      IF v_remaining_to_close <= 0 THEN
        EXIT;
      END IF;

      v_lot_close_amount := LEAST(v_current_lot.remaining_amount_base_units::numeric, v_remaining_to_close);
      v_lot_cost_basis := (v_current_lot.cost_basis_usd * v_lot_close_amount) / v_current_lot.acquired_amount_base_units::numeric;
      v_lot_proceeds := (p_input_value_usd * v_lot_close_amount) / p_amount_in::numeric;
      v_lot_realized_pnl := v_lot_proceeds - v_lot_cost_basis;

      -- Insert closure record
      INSERT INTO portfolio_lot_closures (
        match_id, agent_id, token_address, trade_id, lot_id,
        amount_closed_base_units, cost_basis_closed_usd, proceeds_usd, realized_pnl_usd
      ) VALUES (
        p_match_id, p_agent_id, lower(p_token_in), p_trade_id, v_current_lot.id,
        v_lot_close_amount::text, v_lot_cost_basis, v_lot_proceeds, v_lot_realized_pnl
      );

      -- Accumulate realized PnL
      v_realized_pnl_usd := v_realized_pnl_usd + v_lot_realized_pnl;
      v_closed_cost_basis_usd := v_closed_cost_basis_usd + v_lot_cost_basis;

      -- Update or close the lot
      IF v_lot_close_amount = v_current_lot.remaining_amount_base_units::numeric THEN
        -- Full closure
        UPDATE portfolio_lots
        SET
          remaining_amount_base_units = '0',
          cost_basis_usd = 0,
          closed_at = p_accepted_at
        WHERE id = v_current_lot.id;
      ELSE
        -- Partial closure
        UPDATE portfolio_lots
        SET
          remaining_amount_base_units = (remaining_amount_base_units::numeric - v_lot_close_amount)::text,
          cost_basis_usd = cost_basis_usd - v_lot_cost_basis
        WHERE id = v_current_lot.id;
      END IF;

      v_remaining_to_close := v_remaining_to_close - v_lot_close_amount;
    END LOOP;
  END IF;

  -- For v2 matches: if buy or swap, create new lot for tokenOut
  IF v_trade_rules_version = 'bidirectional_v2' AND (NOT v_is_sell) THEN
    INSERT INTO portfolio_lots (
      match_id, agent_id, token_address,
      acquired_amount_base_units, remaining_amount_base_units,
      cost_basis_usd, acquired_at, source_trade_id
    ) VALUES (
      p_match_id, p_agent_id, lower(p_token_out),
      p_simulated_amount_out, p_simulated_amount_out,
      p_output_value_usd, p_accepted_at, p_trade_id
    );
  END IF;

  -- Insert trade row with all metadata
  INSERT INTO simulated_trades (
    id, match_id, agent_id, seat, phase, token_in, token_out,
    amount_in, quoted_amount_out, simulated_amount_out, slippage_bps,
    quote_snapshot_id, status, accepted_at,
    estimated_value_usd, price_at_trade, token_category,
    trade_side, realized_pnl_usd, closed_cost_basis_usd,
    input_value_usd, output_value_usd, retryable
  ) VALUES (
    p_trade_id, p_match_id, p_agent_id, p_seat, p_phase,
    lower(p_token_in), lower(p_token_out), p_amount_in, p_quoted_amount_out,
    p_simulated_amount_out, p_slippage_bps, p_quote_snapshot_id,
    'accepted', p_accepted_at,
    p_output_value_usd, v_price_at_trade, v_token_category,
    p_trade_side, v_realized_pnl_usd, v_closed_cost_basis_usd,
    p_input_value_usd, p_output_value_usd, true
  );

  -- Insert ledger entries (unchanged from v1)
  INSERT INTO portfolio_ledger_entries (
    match_id, agent_id, trade_id, entry_type,
    token_address, amount_base_units, value_usd, metadata
  ) VALUES (
    p_match_id, p_agent_id, p_trade_id, 'trade_debit',
    lower(p_token_in), p_amount_in, p_input_value_usd, jsonb_build_object('tradeId', p_trade_id)
  );

  INSERT INTO portfolio_ledger_entries (
    match_id, agent_id, trade_id, entry_type,
    token_address, amount_base_units, value_usd, metadata
  ) VALUES (
    p_match_id, p_agent_id, p_trade_id, 'trade_credit',
    lower(p_token_out), p_simulated_amount_out, p_output_value_usd, jsonb_build_object('tradeId', p_trade_id)
  );

  -- Emit match event
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
      'tradeSide', p_trade_side,
      'realizedPnlUsd', v_realized_pnl_usd,
      'closedCostBasisUsd', v_closed_cost_basis_usd,
      'tradeRulesVersion', v_trade_rules_version
    )
  );

  RETURN jsonb_build_object(
    'status', 'accepted',
    'tradeId', p_trade_id,
    'tradeSide', p_trade_side,
    'realizedPnlUsd', v_realized_pnl_usd,
    'closedCostBasisUsd', v_closed_cost_basis_usd
  );
END;
$$;

ALTER FUNCTION accept_bidirectional_trade SET search_path = public;

-- ============================================================
-- 6. Helper function to classify trade side
-- ============================================================

CREATE OR REPLACE FUNCTION classify_trade_side(
  p_token_in text,
  p_token_out text,
  p_usdc_address text DEFAULT '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
) RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF lower(p_token_in) = lower(p_usdc_address) AND lower(p_token_out) <> lower(p_usdc_address) THEN
    RETURN 'buy';
  END IF;

  IF lower(p_token_in) <> lower(p_usdc_address) AND lower(p_token_out) = lower(p_usdc_address) THEN
    RETURN 'sell';
  END IF;

  IF lower(p_token_in) <> lower(p_usdc_address) AND lower(p_token_out) <> lower(p_usdc_address) THEN
    RETURN 'swap';
  END IF;

  RETURN NULL; -- USDC -> USDC is invalid
END;
$$;

-- ============================================================
-- 7. Enable realtime for new tables
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'portfolio_lots'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.portfolio_lots';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'portfolio_lot_closures'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.portfolio_lot_closures';
  END IF;
END
$$;
