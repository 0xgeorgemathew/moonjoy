-- Make quote_snapshot_id nullable so rejected trades without a quote can be persisted
ALTER TABLE simulated_trades
  ALTER COLUMN quote_snapshot_id DROP NOT NULL;

-- Add per-token balances jsonb to valuation snapshots
ALTER TABLE portfolio_valuation_snapshots
  ADD COLUMN IF NOT EXISTS balances jsonb DEFAULT '[]';

-- Add comment documenting the balances shape
COMMENT ON COLUMN portfolio_valuation_snapshots.balances IS
  'Array of {tokenAddress, symbol, decimals, amountBaseUnits, valueUsd, priceSource, quoteId}';

-- Atomic accept_simulated_trade RPC
-- Writes: accepted trade row + USDC debit ledger + output token credit ledger + match event
-- Rejects if resulting USDC balance would be negative
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
  v_usdc_debit_id uuid;
  v_token_credit_id uuid;
BEGIN
  -- Compute current USDC balance for this agent/match
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
    -- Insert rejected trade and return failure
    INSERT INTO simulated_trades (
      id, match_id, agent_id, seat, phase, token_in, token_out,
      amount_in, quoted_amount_out, simulated_amount_out, slippage_bps,
      quote_snapshot_id, status, failure_reason, accepted_at
    ) VALUES (
      p_trade_id, p_match_id, p_agent_id, p_seat, p_phase,
      p_token_in, p_token_out, p_amount_in, '0', '0', 0,
      NULL, 'rejected', 'Insufficient USDC balance for atomic trade.', p_accepted_at
    );
    RETURN jsonb_build_object('status', 'rejected', 'reason', 'Insufficient USDC balance for atomic trade.');
  END IF;

  -- Insert accepted trade
  INSERT INTO simulated_trades (
    id, match_id, agent_id, seat, phase, token_in, token_out,
    amount_in, quoted_amount_out, simulated_amount_out, slippage_bps,
    quote_snapshot_id, status, accepted_at
  ) VALUES (
    p_trade_id, p_match_id, p_agent_id, p_seat, p_phase,
    p_token_in, p_token_out, p_amount_in, p_quoted_amount_out,
    p_simulated_amount_out, p_slippage_bps, p_quote_snapshot_id,
    'accepted', p_accepted_at
  );

  -- Insert USDC debit ledger entry
  INSERT INTO portfolio_ledger_entries (
    id, match_id, agent_id, trade_id, entry_type,
    token_address, amount_base_units, value_usd, metadata
  ) VALUES (
    gen_random_uuid(), p_match_id, p_agent_id, p_trade_id, 'trade_debit',
    lower(p_token_in), p_amount_in, p_input_value_usd, jsonb_build_object('tradeId', p_trade_id)
  );

  -- Insert output token credit ledger entry
  INSERT INTO portfolio_ledger_entries (
    id, match_id, agent_id, trade_id, entry_type,
    token_address, amount_base_units, value_usd, metadata
  ) VALUES (
    gen_random_uuid(), p_match_id, p_agent_id, p_trade_id, 'trade_credit',
    lower(p_token_out), p_simulated_amount_out, p_output_value_usd, jsonb_build_object('tradeId', p_trade_id)
  );

  -- Insert match event
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
      'outputValueUsd', p_output_value_usd
    )
  );

  RETURN jsonb_build_object('status', 'accepted', 'tradeId', p_trade_id);
END;
$$;

ALTER FUNCTION accept_simulated_trade SET search_path = public;
