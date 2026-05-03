-- Normalize all token address columns to lowercase
-- This ensures case-insensitive token address comparisons work consistently

-- Collapse pre-existing checksum/lowercase duplicates before the unique
-- (chain_id, address) constraint sees the normalized address.
CREATE TEMP TABLE token_universe_duplicate_map ON COMMIT DROP AS
SELECT
  id,
  first_value(id) OVER (
    PARTITION BY chain_id, lower(address)
    ORDER BY (address = lower(address)) DESC, created_at ASC, id ASC
  ) AS keep_id
FROM token_universe_tokens;

DELETE FROM match_token_allowlists allowlist
USING token_universe_duplicate_map duplicate_token
WHERE allowlist.token_id = duplicate_token.id
  AND duplicate_token.id <> duplicate_token.keep_id
  AND EXISTS (
    SELECT 1
    FROM match_token_allowlists existing
    WHERE existing.match_id = allowlist.match_id
      AND existing.token_id = duplicate_token.keep_id
  );

UPDATE match_token_allowlists allowlist
SET token_id = duplicate_token.keep_id
FROM token_universe_duplicate_map duplicate_token
WHERE allowlist.token_id = duplicate_token.id
  AND duplicate_token.id <> duplicate_token.keep_id;

DELETE FROM token_universe_tokens token
USING token_universe_duplicate_map duplicate_token
WHERE token.id = duplicate_token.id
  AND duplicate_token.id <> duplicate_token.keep_id;

-- Normalize token_universe_tokens.address
UPDATE token_universe_tokens
SET address = LOWER(address)
WHERE address != LOWER(address);

-- Normalize quote_snapshots token addresses
UPDATE quote_snapshots
SET
  token_in = LOWER(token_in),
  token_out = LOWER(token_out)
WHERE token_in != LOWER(token_in) OR token_out != LOWER(token_out);

-- Normalize simulated_trades token addresses
UPDATE simulated_trades
SET
  token_in = LOWER(token_in),
  token_out = LOWER(token_out)
WHERE token_in != LOWER(token_in) OR token_out != LOWER(token_out);

-- Normalize portfolio_ledger_entries.token_address
UPDATE portfolio_ledger_entries
SET token_address = LOWER(token_address)
WHERE token_address != LOWER(token_address);

-- Normalize portfolio_valuation_snapshots balances (JSONB array)
-- The balances column is an array of {tokenAddress, symbol, decimals, amountBaseUnits, valueUsd, priceSource, quoteId}
UPDATE portfolio_valuation_snapshots
SET balances = (
  SELECT jsonb_agg(
    jsonb_set(
      entry,
      '{tokenAddress}',
      LOWER((entry->>'tokenAddress'))
    )
  )
  FROM jsonb_array_elements(balances) AS entry
)
WHERE balances IS NOT NULL
AND jsonb_typeof(balances) = 'array'
AND EXISTS (
  SELECT 1
  FROM jsonb_array_elements(balances) AS entry
  WHERE (entry->>'tokenAddress') != LOWER((entry->>'tokenAddress'))
);

-- Add comments to document lowercase requirement
COMMENT ON COLUMN token_universe_tokens.address IS 'Token address (must be lowercase, checksummed)';
COMMENT ON COLUMN quote_snapshots.token_in IS 'Input token address (lowercase)';
COMMENT ON COLUMN quote_snapshots.token_out IS 'Output token address (lowercase)';
COMMENT ON COLUMN simulated_trades.token_in IS 'Input token address (lowercase)';
COMMENT ON COLUMN simulated_trades.token_out IS 'Output token address (lowercase)';
COMMENT ON COLUMN portfolio_ledger_entries.token_address IS 'Token address (lowercase)';
