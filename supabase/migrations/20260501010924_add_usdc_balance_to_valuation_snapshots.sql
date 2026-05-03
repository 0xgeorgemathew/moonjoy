ALTER TABLE public.portfolio_valuation_snapshots
ADD COLUMN IF NOT EXISTS usdc_balance_usd numeric NOT NULL DEFAULT 0;
