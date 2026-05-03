-- Prevent duplicated match-start capital from inflating simulated portfolios.
--
-- Worker ticks can race while a match is entering live play. The application now
-- treats starting balance initialization as idempotent, and this migration makes
-- that invariant canonical in Postgres.

WITH ranked_starting_balances AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY match_id, agent_id
      ORDER BY created_at ASC, id ASC
    ) AS row_number
  FROM public.portfolio_ledger_entries
  WHERE entry_type = 'starting_balance'
)
DELETE FROM public.portfolio_ledger_entries entries
USING ranked_starting_balances ranked
WHERE entries.id = ranked.id
  AND ranked.row_number > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_portfolio_ledger_single_starting_balance
  ON public.portfolio_ledger_entries (match_id, agent_id)
  WHERE entry_type = 'starting_balance';
