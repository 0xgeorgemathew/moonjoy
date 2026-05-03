-- Hackathon portfolio simplification.
--
-- Simulated match portfolios are now a per-match ledger only:
-- starting USDC, trade debits, trade credits, and penalties. FIFO lots remain
-- in the database for old audit data, but accepted trades no longer read or
-- write them.

create or replace function public.accept_bidirectional_trade(
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
  p_usdc_address text default '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_token_category text;
  v_token_out_decimals integer;
  v_price_at_trade numeric;
  v_token_balance numeric;
begin
  perform pg_advisory_xact_lock(hashtextextended('trade:' || p_match_id::text || ':' || p_agent_id::text, 0));

  if p_amount_in::numeric <= 0 then
    insert into simulated_trades (
      id, match_id, agent_id, seat, phase, token_in, token_out,
      amount_in, quoted_amount_out, simulated_amount_out, slippage_bps,
      quote_snapshot_id, status, failure_reason, accepted_at,
      trade_side, input_value_usd, output_value_usd, retryable
    ) values (
      p_trade_id, p_match_id, p_agent_id, p_seat, p_phase,
      lower(p_token_in), lower(p_token_out), p_amount_in, '0', '0', 0,
      null, 'rejected', 'Trade amount must be positive.', p_accepted_at,
      p_trade_side, p_input_value_usd, p_output_value_usd, false
    );

    return jsonb_build_object(
      'status', 'rejected',
      'reason', 'Trade amount must be positive.',
      'retryable', false
    );
  end if;

  if lower(p_token_in) = lower(p_token_out) then
    insert into simulated_trades (
      id, match_id, agent_id, seat, phase, token_in, token_out,
      amount_in, quoted_amount_out, simulated_amount_out, slippage_bps,
      quote_snapshot_id, status, failure_reason, accepted_at,
      trade_side, input_value_usd, output_value_usd, retryable
    ) values (
      p_trade_id, p_match_id, p_agent_id, p_seat, p_phase,
      lower(p_token_in), lower(p_token_out), p_amount_in, '0', '0', 0,
      null, 'rejected', 'tokenIn and tokenOut must be different.', p_accepted_at,
      p_trade_side, p_input_value_usd, p_output_value_usd, false
    );

    return jsonb_build_object(
      'status', 'rejected',
      'reason', 'tokenIn and tokenOut must be different.',
      'retryable', false
    );
  end if;

  select coalesce(sum(
    case
      when entry_type in ('starting_balance', 'trade_credit') then amount_base_units::numeric
      when entry_type = 'trade_debit' then -amount_base_units::numeric
      else 0
    end
  ), 0)
  into v_token_balance
  from portfolio_ledger_entries
  where match_id = p_match_id
    and agent_id = p_agent_id
    and lower(token_address) = lower(p_token_in);

  if v_token_balance < p_amount_in::numeric then
    insert into simulated_trades (
      id, match_id, agent_id, seat, phase, token_in, token_out,
      amount_in, quoted_amount_out, simulated_amount_out, slippage_bps,
      quote_snapshot_id, status, failure_reason, accepted_at,
      trade_side, input_value_usd, output_value_usd, retryable
    ) values (
      p_trade_id, p_match_id, p_agent_id, p_seat, p_phase,
      lower(p_token_in), lower(p_token_out), p_amount_in, '0', '0', 0,
      null, 'rejected', 'Insufficient tokenIn balance for atomic trade.', p_accepted_at,
      p_trade_side, p_input_value_usd, p_output_value_usd, false
    );

    return jsonb_build_object(
      'status', 'rejected',
      'reason', 'Insufficient tokenIn balance for atomic trade.',
      'retryable', false
    );
  end if;

  select coalesce(
    case when lower(p_token_out) = lower(p_usdc_address) then 6 end,
    (select decimals from token_universe_tokens where lower(address) = lower(p_token_out) and chain_id = 8453 limit 1),
    18
  )
  into v_token_out_decimals;

  if p_simulated_amount_out::numeric > 0 then
    v_price_at_trade := p_output_value_usd / (p_simulated_amount_out::numeric / power(10, v_token_out_decimals));
  else
    v_price_at_trade := null;
  end if;

  select risk_tier
  into v_token_category
  from token_universe_tokens
  where lower(address) = lower(p_token_out)
    and chain_id = 8453
  limit 1;

  if v_token_category is null and lower(p_token_out) = lower(p_usdc_address) then
    v_token_category := 'blue_chip';
  end if;

  insert into simulated_trades (
    id, match_id, agent_id, seat, phase, token_in, token_out,
    amount_in, quoted_amount_out, simulated_amount_out, slippage_bps,
    quote_snapshot_id, status, accepted_at,
    estimated_value_usd, price_at_trade, token_category,
    trade_side, realized_pnl_usd, closed_cost_basis_usd,
    input_value_usd, output_value_usd, retryable
  ) values (
    p_trade_id, p_match_id, p_agent_id, p_seat, p_phase,
    lower(p_token_in), lower(p_token_out), p_amount_in, p_quoted_amount_out,
    p_simulated_amount_out, p_slippage_bps, p_quote_snapshot_id,
    'accepted', p_accepted_at,
    p_output_value_usd, v_price_at_trade, v_token_category,
    p_trade_side, 0, 0,
    p_input_value_usd, p_output_value_usd, true
  );

  insert into portfolio_ledger_entries (
    match_id, agent_id, trade_id, entry_type,
    token_address, amount_base_units, value_usd, metadata
  ) values (
    p_match_id, p_agent_id, p_trade_id, 'trade_debit',
    lower(p_token_in), p_amount_in, p_input_value_usd, jsonb_build_object('tradeId', p_trade_id)
  );

  insert into portfolio_ledger_entries (
    match_id, agent_id, trade_id, entry_type,
    token_address, amount_base_units, value_usd, metadata
  ) values (
    p_match_id, p_agent_id, p_trade_id, 'trade_credit',
    lower(p_token_out), p_simulated_amount_out, p_output_value_usd, jsonb_build_object('tradeId', p_trade_id)
  );

  insert into match_events (match_id, event_type, payload)
  values (
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
      'realizedPnlUsd', 0,
      'closedCostBasisUsd', 0,
      'tradeRulesVersion', 'ledger_only_v1'
    )
  );

  return jsonb_build_object(
    'status', 'accepted',
    'tradeId', p_trade_id,
    'tradeSide', p_trade_side,
    'realizedPnlUsd', 0,
    'closedCostBasisUsd', 0
  );
end;
$$;

revoke execute on function public.accept_bidirectional_trade(
  uuid, uuid, uuid, text, text, text, text, text, text, text,
  integer, uuid, numeric, numeric, timestamptz, text, text
) from anon, authenticated, public;

grant execute on function public.accept_bidirectional_trade(
  uuid, uuid, uuid, text, text, text, text, text, text, text,
  integer, uuid, numeric, numeric, timestamptz, text, text
) to service_role;
