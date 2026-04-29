# Base Mainnet Trading Game Implementation Plan

This plan upgrades Moonjoy from a match shell into a Base mainnet trading game that uses real market data, safe simulated execution, and clear game rules. It follows the existing project boundary:

```txt
apps/web
  Next.js API routes, UI, MCP endpoint, Privy auth, service adapters

apps/worker
  timers, quote refresh, discovery refresh, autonomous game loop jobs

packages/game
  pure match rules, phase rules, scoring, penalties, winner selection

supabase
  app workflow state, quote snapshots, simulated fills, portfolio snapshots
```

`packages/game` must stay runtime agnostic. It should own the math and phase rules, but it must not import Uniswap, Dexscreener, Supabase, Next.js, environment variables, Privy, ENS, filesystem APIs, or chain clients.

## Product Decisions

- Chain: Base mainnet only, chain id `8453`.
- Primary scoring rule: highest PnL percentage from each agent's starting marked portfolio value.
- Secondary display metric: final portfolio value.
- Default demo match: 5 minutes live duration, 30 second warm-up, $10 wager, $100 simulated trading capital.
- Market data source: Uniswap Trading API quotes for all portfolio valuation and simulated fills.
- Token discovery source: Dexscreener raw pair data, processed by Moonjoy MCP tooling.
- Execution mode for the first version: quote-backed simulated fills only. No real swaps are submitted.
- Future execution mode: use Uniswap dry-run/simulation checks before any signed transaction can be broadcast.

The game may store quote and fill snapshots for replay, but token balances and executable market prices must always be refreshed from Base mainnet quotes when they affect readiness, scoring, or settlement.

## Required Tools And APIs

### Uniswap Trading API

Use the Uniswap Trading API from server-side code only.

```txt
Base URL: https://trade-api.gateway.uniswap.org/v1
Required env: UNISWAP_API_KEY
Required headers:
  Content-Type: application/json
  Accept: application/json
  x-api-key: ${UNISWAP_API_KEY}
  x-universal-router-version: 2.0
```

Relevant endpoints:

- `POST /quote`: fetches real Base liquidity quotes.
- `POST /check_approval`: future real execution approval check.
- `POST /swap`: future real execution calldata creation and dry-run simulation for CLASSIC, WRAP, and UNWRAP routes.
- Do not call `/order` in simulated matches. Submitting a UniswapX order is real intent submission to filler infrastructure.

Base Universal Router 2.0 address from Uniswap supported-chain docs:

```txt
0x6ff5693b99212da76ad316178a184ab56d299b43
```

For the first demo, prefer CLASSIC AMM routes by requesting:

```json
{
  "routingPreference": "BEST_PRICE",
  "protocols": ["V2", "V3", "V4"]
}
```

Reason: Moonjoy's default demo trade sizes are below the L2 UniswapX minimum quote value. Uniswap currently documents L2 UniswapX quote requests on Base and Arbitrum as requiring at least 1,000 USDC equivalent. CLASSIC routes also produce deterministic calldata for dry-run simulation later.

### Base RPC

Use a reliable Base mainnet RPC for:

- ERC-20 decimals and symbol verification.
- Onchain balance reads for agent smart accounts when real funding is shown.
- `eth_call` / viem `publicClient.call` dry-run checks for generated swap calldata.
- Future receipt verification if real execution is enabled.

Required env:

```txt
BASE_RPC_URL
```

### Dexscreener

Dexscreener is a discovery input, not a decision engine.

Use:

```txt
GET https://api.dexscreener.com/token-profiles/latest/v1
GET https://api.dexscreener.com/token-boosts/latest/v1
GET https://api.dexscreener.com/token-boosts/top/v1
GET https://api.dexscreener.com/latest/dex/search?q={query}
GET https://api.dexscreener.com/token-pairs/v1/base/{tokenAddress}
GET https://api.dexscreener.com/tokens/v1/base/{commaSeparatedTokenAddresses}
```

Dexscreener documents 60 requests/minute for profile, takeover, ads, and boost endpoints, and 300 requests/minute for pair, search, token-pair, and token batch endpoints. Cache raw responses and run Moonjoy filters in the MCP tool layer.

## Quote Fetching, Validation, And Refresh

### Quote Request

Create a focused service in `apps/web/lib/services/uniswap-quote-service.ts`.

```ts
type QuoteExactInputParams = {
  swapper: `0x${string}`;
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  amountBaseUnits: string;
  slippageBps: number;
};
```

Request body:

```json
{
  "type": "EXACT_INPUT",
  "tokenInChainId": 8453,
  "tokenOutChainId": 8453,
  "tokenIn": "0x...",
  "tokenOut": "0x...",
  "amount": "1000000",
  "swapper": "0x...",
  "slippageTolerance": 0.5,
  "routingPreference": "BEST_PRICE",
  "protocols": ["V2", "V3", "V4"],
  "urgency": "normal"
}
```

Validation rules:

- Reject non-Base chain IDs.
- Reject invalid EVM addresses before calling Uniswap.
- Reject zero or negative amounts.
- Resolve token decimals onchain or from a verified token registry before converting user units to base units.
- Require `routing` in the response.
- Require a positive output amount.
- Require `requestId` and store it with the quote snapshot.
- Require route data for CLASSIC quotes.
- Reject unsupported routing types in simulated matches unless handling is explicit.
- Reject quotes whose `txFailureReasons` is non-empty when present.
- Reject quotes with price impact above configured limits.
- Reject quotes older than 20 seconds for trade acceptance.

Routing-aware output extraction:

```ts
function getQuotedOutputAmount(response: QuoteResponse): string {
  if (response.routing === "DUTCH_V2" || response.routing === "DUTCH_V3" || response.routing === "PRIORITY") {
    const firstOutput = response.quote.orderInfo.outputs[0];
    if (!firstOutput) throw new Error("UniswapX quote has no output.");
    return firstOutput.startAmount;
  }

  return response.quote.output.amount;
}
```

For the demo, reject `DUTCH_V2`, `DUTCH_V3`, `PRIORITY`, `LIMIT_ORDER`, `BRIDGE`, and `CHAINED` for simulated fills. They can still be displayed as unsupported route types in logs. This avoids accidentally treating gasless order submission as a harmless simulation.

### Quote Refresh

Use these refresh intervals:

- Trade ticket preview: refresh every 10 seconds while the agent is deciding.
- Trade acceptance: fetch a fresh quote immediately before accepting a fill.
- Portfolio valuation during live phase: every 10 seconds per active match, plus after every accepted trade.
- Leaderboard: recompute after every trade and after each phase transition.
- Final settlement: fetch fresh quotes for every non-USDC position within the settlement phase.

Every accepted trade must store both:

- The preview quote shown to the agent, if any.
- The final acceptance quote that determines the simulated fill.

The final acceptance quote is the authoritative fill input.

## Dry-Run Execution Model

Moonjoy needs two different meanings of "dry run".

### Current Demo Dry Run: Simulated Fill

The demo must not submit real swaps, signatures, approvals, or UniswapX orders.

Flow:

1. Agent proposes `tokenIn`, `tokenOut`, and `amount`.
2. Server verifies the agent has enough simulated balance.
3. Server fetches a fresh Uniswap `POST /quote` response from Base mainnet.
4. Server validates route, output, price impact, slippage, and quote age.
5. Server accepts the trade by writing a simulated fill with:
   - input amount debited
   - quoted output credited
   - slippage recorded as `0` for quote-backed fills unless an execution model haircut is configured
   - quote request/response snapshot stored for replay
6. Portfolio and leaderboard recompute immediately.

This is safe because no signed transaction is produced and nothing is broadcast.

### Future Real-Execution Dry Run: Calldata Simulation

Before real swaps are considered, add a pre-execution mode that still does not broadcast:

1. Call `/check_approval` for token, amount, wallet, chain id.
2. If approval is required, stop and surface the required approval transaction. Do not auto-approve.
3. Fetch a fresh `/quote`.
4. For CLASSIC, WRAP, or UNWRAP routes, call `/swap` with:

```json
{
  "quote": { "...": "fresh quote object" },
  "signature": "0x...",
  "permitData": { "...": "only when required and non-null" },
  "refreshGasPrice": true,
  "simulateTransaction": true,
  "safetyMode": "SAFE",
  "deadline": 1770000000,
  "urgency": "normal"
}
```

5. Validate the returned transaction:
   - `to` is the Base Universal Router.
   - `from` is the agent smart account.
   - `chainId` is `8453`.
   - `data` is non-empty hex.
   - `value` is present.
   - gas fields are present.
6. Run a local `eth_call` / viem `publicClient.call` against Base RPC using the returned transaction.
7. Store the simulation result, request id, block number, and timestamp.
8. Do not call `sendTransaction`.

Uniswap simulation is not a guarantee of future success because gas, balances, approvals, route state, and slippage can change before broadcast. For Moonjoy this dry-run result is a safety gate, not a settlement source.

## Game Phase Design

Use explicit phases rather than overloading `live`.

```txt
created
  Purpose: challenge exists with creator terms.
  Duration: until accepted or expired.
  Allowed actions: creator cancels, opponent accepts.
  Scoring impact: none.

warmup
  Purpose: both agents receive token universe, starting balances, rules, and strategy context.
  Duration: 30 seconds default.
  Allowed actions: inspect tokens, request quotes, discover tokens, publish strategy intent.
  Disallowed actions: accepted trades.
  Scoring impact: none, but strategy provenance is recorded.

opening_window
  Purpose: force early market participation.
  Duration: first 60 seconds of live match.
  Allowed actions: trades, quotes, discovery.
  Mandatory action: at least one accepted trade per agent.
  Scoring impact: normal PnL plus penalty if missed.

midgame
  Purpose: autonomous trading and recovery.
  Duration: middle 180 seconds in the default 5 minute match.
  Allowed actions: trades, quotes, discovery.
  Mandatory action: none by default.
  Scoring impact: normal PnL.

closing_window
  Purpose: force final risk management decision.
  Duration: final 60 seconds of live match.
  Allowed actions: trades, quotes, discovery; optional de-risking to USDC.
  Mandatory action: at least one accepted trade per agent.
  Scoring impact: normal PnL plus penalty if missed.

settling
  Purpose: compute final values using fresh Base mainnet quotes.
  Duration: up to 15 second grace period.
  Allowed actions: no new trades, valuation only.
  Scoring impact: final scoring, penalties, tie-breakers.

settled
  Purpose: immutable replay and winner display.
  Duration: permanent.
  Allowed actions: read replay.
  Scoring impact: none after settlement.
```

In `packages/game`, keep the persisted match status small if needed (`created`, `warmup`, `live`, `settling`, `settled`) and derive live sub-phases from timestamps:

```ts
type LiveSubphase = "opening_window" | "midgame" | "closing_window";
```

## Mandatory Trading Windows And Penalties

For each mandatory window, compute whether every agent has at least one accepted trade with `accepted_at` inside the window.

Default penalty:

```txt
missed mandatory window penalty = max(2.5% of starting portfolio value, $2.50)
```

Penalty model:

- Penalties reduce score, not simulated balances.
- Store penalties separately from realized PnL and unrealized PnL.
- Display gross PnL, penalties, and net score.
- Winner selection uses net PnL percentage.

```ts
netScoreUsd = totalPnlUsd - totalPenaltyUsd
netScorePercent = netScoreUsd / startingPortfolioValueUsd
```

This avoids hidden balance mutations while making failure to participate matter.

## Token Universe

All tokens below are Base mainnet tokens. Addresses must still be verified before implementation by onchain metadata reads and a fresh quote check.

### Blue-Chip List

These are relatively established or liquid Base assets for the first curated universe:

```txt
ETH native
  address: 0x0000000000000000000000000000000000000000
  role: native gas asset and benchmark asset

WETH
  address: 0x4200000000000000000000000000000000000006
  role: main Base wrapped ETH liquidity

USDC
  address: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
  role: stable quote and accounting asset

cbBTC
  address: 0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf
  role: Coinbase wrapped BTC exposure

cbETH
  address: 0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22
  role: Coinbase staked ETH exposure

wstETH
  address: 0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452
  role: liquid staking ETH exposure

AERO
  address: 0x940181a94A35A4569E4529A3CDfB74e38FD98631
  role: major Base DEX ecosystem token

VIRTUAL
  address: 0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b
  role: established Base AI/agent ecosystem token
```

### Pink Slip List

These are riskier, more volatile, and more narrative-driven. They should use stricter per-trade caps and always require a fresh quote before acceptance:

```txt
DEGEN
  address: 0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed
  risk: volatile community/social token

BRETT
  address: 0x532f27101965dd16442E59d40670FaF5eBB142E4
  risk: meme token with meaningful liquidity but high volatility

TOSHI
  address: 0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4
  risk: meme token, volatile liquidity conditions

SKI
  address: 0x768BE13e1680b5ebE0024C42c896E3dB59ec0149
  risk: meme token, volatility and liquidity concentration risk

MOCHI
  address: 0xF6e932Ca12afa26665dC4dDE7e27be02A7c02e50
  risk: lower liquidity and higher slippage risk
```

Initial risk limits:

```txt
Blue-chip max position: 80% of portfolio value per token
Pink slip max position: 25% of portfolio value per token
Discovered token max position: 15% of portfolio value per token
Minimum accepted trade: $1 equivalent
Maximum accepted trade: 50% of current portfolio value
Max price impact blue-chip: 2%
Max price impact pink slip: 5%
Max price impact discovered: 8%
```

## Token Discovery Through MCP

Add MCP tools under the existing Moonjoy MCP service:

```txt
moonjoy.discover_base_tokens
  Input:
    query?: string
    minLiquidityUsd?: number
    minVolume24hUsd?: number
    minTxns1h?: number
    maxAgeHours?: number
  Output:
    filtered discovered token candidates with rejection reasons for excluded pairs

moonjoy.get_token_risk_profile
  Input:
    tokenAddress
  Output:
    token metadata, Dexscreener pair summary, quote availability, risk tier

moonjoy.request_trade_quote
  Input:
    matchId, tokenIn, tokenOut, amount
  Output:
    fresh Uniswap quote summary, not a fill

moonjoy.submit_simulated_trade
  Input:
    matchId, tokenIn, tokenOut, amount, quoteRequestId?
  Output:
    accepted fill or explicit rejection reason
```

Discovery flow:

1. Fetch raw Dexscreener data.
2. Keep only rows with `chainId === "base"`.
3. Normalize token addresses to checksum format.
4. Group pairs by base token address.
5. For each token, choose the best pair by liquidity first, then 24h volume.
6. Apply filters:
   - liquidity USD >= `$50,000` default
   - 24h volume USD >= `$25,000` default
   - 1h transactions >= `20` default
   - last observed activity within 15 minutes if available
   - pair age at least 1 hour unless the match explicitly allows fresh launches
7. Reject tokens already on an unsupported or local deny list.
8. Verify ERC-20 metadata onchain.
9. Request a Uniswap quote from USDC to the token and token to USDC using a small test size.
10. If both quotes are valid, mark the token as available for the current match.

Dexscreener does not choose winners, strategies, or availability by itself. Moonjoy uses Dexscreener only as raw market discovery data, then validates tradability through Uniswap quotes.

## Agent Trading Rules

Allowed:

- Trade from any currently held token into a curated token.
- Trade from any currently held token into an eligible discovered token.
- Request quotes during warm-up and live phases.
- Use Dexscreener discovery during warm-up and live phases.
- Hold multiple assets.
- De-risk to USDC before close.

Disallowed:

- Trade during `created`, `warmup`, `settling`, or `settled`.
- Trade tokens that are not in the curated list or current match discovery allowlist.
- Trade with stale quotes.
- Trade more than available simulated balance.
- Trade if the quote output is zero or missing.
- Trade if price impact exceeds tier limits.
- Trade if Uniswap returns no route.
- Trade if token metadata cannot be verified.
- Trade fee-on-transfer or rebasing tokens unless explicitly allowlisted later.

Every trade record must include:

```txt
match_id
agent_id
seat
timestamp
phase
input_token
output_token
input_amount_base_units
quoted_output_base_units
actual_or_simulated_output_base_units
slippage_bps
uniswap_request_id
quote_snapshot_id
routing
route_summary
gas_estimate
gas_fee_usd
price_impact_bps
status
failure_reason
```

## Balance And PnL Accounting

Use a ledger model for simulated balances.

### Starting Portfolio

Default demo starting state:

```txt
USDC: 100.00
All other tokens: 0
```

If the product later lets agents bring capital from smart accounts, mark the starting portfolio at match start using fresh Uniswap quotes into USDC.

### Balance Updates

On accepted trade:

1. Lock match row or ledger stream for the agent.
2. Read current simulated balance for `tokenIn`.
3. Reject if insufficient.
4. Debit exact `tokenIn`.
5. Credit `actual_or_simulated_output`.
6. Append immutable ledger entries.
7. Revalue portfolio.
8. Recompute leaderboard.

Ledger entries:

```txt
trade_debit
trade_credit
penalty
valuation_snapshot
```

Do not update balances by mutating a single opaque JSON object without an audit ledger.

### Realized And Unrealized PnL

Use USDC as the accounting currency.

Track lots for realized PnL:

- Each acquisition creates or increases a lot at the USDC value of the input given up.
- Selling or swapping out of a token closes lots FIFO.
- Realized PnL is the USDC value received minus the cost basis of the lots closed.
- For token-to-token swaps, value the output token in USDC using the acceptance quote path or an immediate output-to-USDC quote.

Unrealized PnL:

```txt
current marked value of open lots - remaining cost basis
```

Total PnL:

```txt
totalPnlUsd = realizedPnlUsd + unrealizedPnlUsd
pnlPercent = totalPnlUsd / startingPortfolioValueUsd
netScoreUsd = totalPnlUsd - penaltiesUsd
netScorePercent = netScoreUsd / startingPortfolioValueUsd
```

Portfolio display must include:

```txt
starting portfolio value
current portfolio value
realized PnL
unrealized PnL
total PnL
PnL percentage
penalties
net score percentage
```

### Valuation Quotes

For each non-USDC balance:

1. Quote full balance to USDC through Uniswap on Base.
2. If full balance quote fails, try chunked valuation with deterministic chunks.
3. If chunked valuation fails, mark token as temporarily unpriceable and apply the conservative value:
   - `0` for final settlement
   - last valid marked value for live UI only, clearly flagged stale

Final settlement must not use stale values.

## Leaderboard Logic

Leaderboard rows:

```txt
rank
agent_id
agent_ens
seat
current_value_usd
realized_pnl_usd
unrealized_pnl_usd
total_pnl_usd
pnl_percent
penalties_usd
net_score_percent
mandatory_windows_completed
failed_trade_count
max_drawdown_percent
last_profitable_trade_at
updated_at
```

Sort:

1. Highest `net_score_percent`.
2. Highest `realized_pnl_usd`.
3. Lowest `max_drawdown_percent`.
4. Fewest failed trades.
5. Earliest profitable final trade.
6. If still tied, declare a tie.

The leaderboard updates:

- after every accepted trade
- after every failed mandatory window assessment
- at phase transitions
- during live valuation refreshes
- at final settlement

## Failure Handling

Quote failures:

- Store `quote_failed` event with token pair, amount, source, HTTP status, and sanitized error body.
- Return a typed rejection to the agent.
- Do not mutate balances.

Trade acceptance race:

- Use a per-match-agent advisory lock or transaction lock.
- Re-read balance inside the lock.
- Fetch or validate a fresh quote inside the lock.
- Commit ledger entries and fill atomically.

Dexscreener failures:

- Use cached discovery candidates for UI only if fresh within 2 minutes.
- Do not admit new discovered tokens unless the Dexscreener response and Uniswap quote validation both succeed.

Valuation failures:

- During live phase, show stale marker and keep retrying.
- During settlement, use conservative value `0` for unpriceable non-USDC positions and store the failure reason.

Mandatory trade failures:

- Assess penalty once per agent per window.
- Store a `mandatory_window_penalty` event.
- Never double-apply the same window penalty.

Rate limits:

- Exponential backoff on 429 responses.
- Per-match queue to avoid quote storms.
- Cache identical valuation quotes for at most 10 seconds.

## Security And Risk Controls

- Keep `UNISWAP_API_KEY` server-side only.
- Do not call Uniswap from browser components.
- Do not broadcast transactions in demo mode.
- Do not call UniswapX `/order` in demo mode.
- Validate all EVM addresses.
- Maintain token allowlists, denylists, and per-tier caps.
- Reject tokens with missing decimals, strange decimals above 36, or metadata read failures.
- Reject known fee-on-transfer, rebasing, pausable, honeypot, or transfer-restricted tokens unless explicitly reviewed.
- Store full quote snapshots for audit, but sanitize secrets and auth headers.
- Verify any future transaction receipt by chain id, status, target router, sender, calldata intent, and resulting balances.
- Use explicit route allowlists for real execution.
- Require user approval before any real transaction that spends gas or transfers tokens.
- Make simulation mode visible in UI and database fields.

## Suggested Data Schema

Add a migration after the existing match lifecycle migrations.

```sql
create table token_universe_tokens (
  id uuid primary key default gen_random_uuid(),
  chain_id integer not null check (chain_id = 8453),
  address text not null,
  symbol text not null,
  name text not null,
  decimals integer not null check (decimals >= 0 and decimals <= 36),
  risk_tier text not null check (risk_tier in ('blue_chip', 'pink_slip', 'discovered')),
  is_active boolean not null default true,
  source text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (chain_id, address)
);

create table match_token_allowlists (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  token_id uuid not null references token_universe_tokens(id),
  admitted_by text not null,
  admitted_at timestamptz not null default now(),
  discovery_snapshot_id uuid,
  unique (match_id, token_id)
);

create table quote_snapshots (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references matches(id) on delete cascade,
  agent_id uuid references agents(id) on delete set null,
  chain_id integer not null check (chain_id = 8453),
  source text not null check (source = 'uniswap'),
  request_id text,
  token_in text not null,
  token_out text not null,
  amount_in text not null,
  quoted_amount_out text not null,
  routing text not null,
  route_summary jsonb not null default '{}'::jsonb,
  gas_estimate text,
  gas_fee_usd numeric(18, 8),
  price_impact_bps integer,
  slippage_bps integer not null,
  block_number text,
  request_payload jsonb not null,
  response_payload jsonb not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table simulated_trades (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  seat text not null check (seat in ('creator', 'opponent')),
  phase text not null,
  token_in text not null,
  token_out text not null,
  amount_in text not null,
  quoted_amount_out text not null,
  simulated_amount_out text not null,
  slippage_bps integer not null,
  quote_snapshot_id uuid not null references quote_snapshots(id),
  status text not null check (status in ('accepted', 'rejected')),
  failure_reason text,
  accepted_at timestamptz not null default now()
);

create table portfolio_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  trade_id uuid references simulated_trades(id) on delete set null,
  entry_type text not null check (entry_type in ('starting_balance', 'trade_debit', 'trade_credit', 'penalty')),
  token_address text,
  amount_base_units text,
  value_usd numeric(18, 8),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table portfolio_valuation_snapshots (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  phase text not null,
  starting_value_usd numeric(18, 8) not null,
  current_value_usd numeric(18, 8) not null,
  realized_pnl_usd numeric(18, 8) not null,
  unrealized_pnl_usd numeric(18, 8) not null,
  total_pnl_usd numeric(18, 8) not null,
  pnl_percent numeric(18, 8) not null,
  penalties_usd numeric(18, 8) not null,
  net_score_percent numeric(18, 8) not null,
  max_drawdown_percent numeric(18, 8) not null default 0,
  quote_snapshot_ids uuid[] not null default '{}',
  stale boolean not null default false,
  created_at timestamptz not null default now()
);

create table token_discovery_snapshots (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references matches(id) on delete cascade,
  query text,
  raw_source text not null check (raw_source = 'dexscreener'),
  raw_payload jsonb not null,
  filtered_payload jsonb not null,
  rejected_payload jsonb not null,
  created_at timestamptz not null default now()
);

create table mandatory_window_results (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  window_name text not null check (window_name in ('opening_window', 'closing_window')),
  completed boolean not null,
  penalty_usd numeric(18, 8) not null default 0,
  assessed_at timestamptz not null default now(),
  unique (match_id, agent_id, window_name)
);
```

## Step-By-Step Implementation Tasks

1. Add pure phase helpers in `packages/game`.
   - Derive opening, midgame, and closing windows from match timing.
   - Add mandatory-window completion and penalty helpers.
   - Add winner selection with tie-breakers.
   - Add focused tests.

2. Add token universe types.
   - Keep pure token risk tier types in `packages/game` if needed.
   - Keep actual token metadata and addresses in `apps/web/lib/services/token-universe-service.ts` or DB seed data.

3. Add Supabase migration for quote, trade, ledger, valuation, discovery, and mandatory-window tables.

4. Implement `uniswap-quote-service.ts`.
   - Server-side only.
   - Validate inputs.
   - Call `/quote`.
   - Parse routing with discriminated unions.
   - Store quote snapshots.
   - Expose fresh quote helpers for trade fills and portfolio valuation.

5. Implement `dexscreener-discovery-service.ts`.
   - Fetch raw Dexscreener data.
   - Store raw snapshots.
   - Filter by Base, liquidity, volume, activity, and pair age.
   - Verify token metadata onchain.
   - Validate tradability with Uniswap quotes.

6. Add MCP tools.
   - Discovery.
   - Risk profile.
   - Quote request.
   - Simulated trade submission.
   - Portfolio and leaderboard read.

7. Implement portfolio ledger service.
   - Initialize starting balances at live start.
   - Apply trade debit and credit atomically.
   - Calculate realized and unrealized PnL.
   - Write valuation snapshots.

8. Implement trade acceptance route.
   - `POST /api/matches/[id]/trades`
   - Authenticate user and authorized agent.
   - Check match phase.
   - Check token allowlist.
   - Lock match-agent ledger.
   - Fetch fresh quote.
   - Validate quote.
   - Write simulated trade and ledger entries.
   - Recompute leaderboard.

9. Implement worker loop.
   - Reconcile phase transitions.
   - Initialize live portfolios.
   - Refresh valuations.
   - Assess mandatory windows once.
   - Settle final results with fresh quotes.

10. Update arena UI.
    - Show phase, timer, mandatory window status, balances, PnL, trade tape, quote route, leaderboard, and replay snapshots.
    - Explicitly label "simulated fill from live Uniswap quote".

11. Add dry-run execution service for future real trades.
    - Keep disabled behind `ENABLE_REAL_SWAP_DRY_RUN=false`.
    - Implement `/check_approval`, `/swap simulateTransaction`, response validation, and `eth_call`.
    - Never broadcast.

12. Verification.
    - Unit test pure phase, penalty, PnL, and winner rules.
    - Service test quote parsing with recorded sanitized fixtures for CLASSIC and unsupported routing.
    - Integration test simulated trade acceptance with mocked HTTP responses only for tests.
    - Manual smoke test against Base mainnet quotes in a separate script that never writes fills.

## Main Game Loop Pseudocode

```ts
async function tickActiveMatch(matchId: string, now: Date): Promise<void> {
  const match = await matchService.getForUpdate(matchId);
  const previousPhase = deriveMatchPhase(match, match.updatedAt);
  const phase = deriveMatchPhase(match, now);

  if (phase.name !== previousPhase.name) {
    await matchService.recordPhaseTransition(match.id, phase);
  }

  if (previousPhase.name === "warmup" && phase.name === "opening_window") {
    await portfolioService.ensureStartingBalances(match.id);
    await valuationService.markAllPortfolios(match.id, { requireFresh: true });
    await leaderboardService.recompute(match.id);
  }

  if (phase.name === "opening_window" || phase.name === "midgame" || phase.name === "closing_window") {
    await valuationService.markAllPortfolios(match.id, { requireFresh: false, maxAgeSeconds: 10 });
    await leaderboardService.recompute(match.id);
  }

  for (const window of getMandatoryWindowsEndingAt(match, now)) {
    await penaltyService.assessMandatoryWindow(match.id, window);
    await valuationService.markAllPortfolios(match.id, { requireFresh: true });
    await leaderboardService.recompute(match.id);
  }

  if (phase.name === "settling") {
    await tradeService.closeTrading(match.id);
    await valuationService.markAllPortfolios(match.id, { requireFresh: true, final: true });
    const result = await leaderboardService.selectWinner(match.id);
    await matchService.settle(match.id, result);
  }
}

async function submitSimulatedTrade(input: SubmitTradeInput): Promise<TradeResult> {
  return await db.transaction(async (tx) => {
    const match = await matchService.getForUpdate(input.matchId, tx);
    const phase = deriveMatchPhase(match, new Date());

    if (!isTradingAllowed(phase)) {
      return rejectTrade("Trading is not allowed in this phase.");
    }

    await tokenPolicyService.assertTokenAllowed(match.id, input.tokenIn, input.tokenOut, tx);

    const balance = await portfolioService.getTokenBalanceForUpdate(
      input.matchId,
      input.agentId,
      input.tokenIn,
      tx,
    );

    if (balance < input.amountInBaseUnits) {
      return rejectTrade("Insufficient simulated balance.");
    }

    const quote = await uniswapQuoteService.fetchFreshExactInputQuote({
      swapper: input.agentSmartAccountAddress,
      tokenIn: input.tokenIn,
      tokenOut: input.tokenOut,
      amountBaseUnits: input.amountInBaseUnits.toString(),
      slippageBps: tokenPolicyService.slippageFor(input.tokenOut),
    });

    validateQuoteForSimulatedFill(quote, {
      maxAgeSeconds: 20,
      maxPriceImpactBps: tokenPolicyService.maxPriceImpactFor(input.tokenOut),
      allowedRouting: ["CLASSIC", "WRAP", "UNWRAP"],
    });

    const trade = await tradeService.insertAcceptedTrade({
      matchId: input.matchId,
      agentId: input.agentId,
      phase: phase.name,
      tokenIn: input.tokenIn,
      tokenOut: input.tokenOut,
      amountIn: input.amountInBaseUnits,
      quotedAmountOut: quote.outputAmount,
      simulatedAmountOut: quote.outputAmount,
      slippageBps: 0,
      quoteSnapshotId: quote.snapshotId,
    }, tx);

    await portfolioService.applyTrade(trade, tx);
    await valuationService.markPortfolio(input.matchId, input.agentId, { requireFresh: true }, tx);
    await leaderboardService.recompute(input.matchId, tx);

    return { status: "accepted", tradeId: trade.id };
  });
}
```

## Documentation Sources Checked

- Uniswap Trading API supported chains and Base router: https://developers.uniswap.org/docs/trading/swapping-api/supported-chains
- Uniswap Trading API integration guide: https://developers.uniswap.org/docs/trading/swapping-api/integration-guide
- Uniswap quote API reference: https://api-docs.uniswap.org/api-reference/swapping/quote
- Dexscreener API reference: https://docs.dexscreener.com/api/reference
