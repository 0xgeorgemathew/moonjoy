# Moonjoy Planned Execution Strategy

This plan is intentionally sequential. Each phase has one main outcome and a gate that must be true before the next phase starts. Hackathon speed matters, but the implementation should still preserve correctness, clarity, and restraint.

## Product Decisions

- Moonjoy is a wagered PvP agent trading game.
- The default match duration is 5 minutes.
- Every match has a warm-up stage before the trading clock starts.
- The wager is fixed at $10 for the first demo version.
- The wager is separate from each user's simulated match trading capital.
- For the hackathon demo, each match starts every agent with fresh simulated USDC from `starting_capital_usd` and does not inherit residual wallet tokens from earlier matches.
- Onchain state is the source of truth wherever it exists: ENS names, ENS address resolution, ENS text records, wallet balances, token ownership, escrow deposits, escrow settlement, and transaction success.
- The database must not duplicate onchain state as canonical product state. It may store app-only workflow state, offchain simulation data, and historical snapshots for replay.
- The winner is the player with the best normalized PnL over the match window.
- For fairness, the primary score should be PnL percentage from each player's starting marked portfolio value, not raw dollar PnL.
- A player is a user plus that user's single Moonjoy agent.
- A user always has exactly one agent.
- There is no agent selection during match setup.
- There is no manual strategy selection during match setup.
- A user may own one or more strategies that the user's agent can use during a match.
- Strategy choice is part of the agent's autonomous behavior and must be attributable after the match.

### Humans Decide Who Plays. Agents Decide How To Trade.

- The human user creates and accepts match invites through the web app. The agent never creates, discovers, accepts, or cancels match invites.
- Invite types: `open` (any eligible authenticated human can join) or `ens` (only the holder/resolved controller of a specific ENS name can join).
- Invite terms live server-side. The shareable link carries an opaque invite token, not trusted state.
- Match starts only after both humans have joined. Agent autonomy starts after the human creates or joins a match.
- The agent's job is: inspect assigned match, inspect available simulated balances, discover market opportunities, prepare strategy, mark ready during warm-up, submit quote-backed simulated trades during live play, record rationale.
- User ENS `moonjoy:match_preference` may publish defaults for future automatch: match duration, bet amount, and preferred trading-capital range. This is reserved for future use; the first demo uses human invite links only.
- Agents must never create challenges, browse open challenges, accept opponents, or decide matchmaking.

### Invite Flow

- The user must approve the agent once through Moonjoy MCP before joining a match.
- The user owns the agent relationship and user-owned assets.
- The agent smart account is the player wallet.
- The agent smart account is created during user signup, not during MCP authorization.
- The agent smart account owns agent identity, reputation, victories, stats, wager actions, and trading actions.
- Strategies are owned by the user, assigned to the user's agent, and attributed to the agent when used.
- The human user can fund or withdraw from the agent smart account.
- The agent makes the wager from the agent smart account.
- The agent trades from the agent smart account.
- A match is created only after the creator's $10 wager deposit is recorded.
- Before the escrow contract exists, wager deposits are simulated backend ledger locks. After escrow exists, the same deposit boundary should swap to a real contract deposit.
- Real swap execution is not required for the first demo.
- Live Uniswap quote data and deterministic simulated execution are required for the first demo.
- The wager likely needs an escrow contract once the game moves beyond pure simulation.

### Creator Flow

1. Human signs in.
2. App resolves human ENS from Durin.
3. App checks one active agent and MCP approval.
4. App checks wager readiness. Trading capital initializes as simulated USDC when live play starts.
5. Human chooses: `open` invite or `ens`-scoped invite.
6. Server validates terms.
7. Server locks creator wager.
8. Server creates invite.
9. UI shows shareable link with opaque invite token.

### Joiner Flow

1. Human opens invite link.
2. App loads invite by opaque token from server.
3. If invite is scoped, server resolves scoped ENS through Durin and compares against authenticated human identity.
4. Server checks joiner readiness (same checks as creator).
5. Server locks joiner wager.
6. Server creates or finalizes match seats.
7. Match enters warm-up.
8. Both agents see assigned match through MCP.

### Scoped ENS Invite Rules

- `scoped_ens_name` must be normalized.
- Scoped ENS must resolve through Durin at join time.
- Joiner must prove authenticated control through the same identity path Moonjoy already trusts.
- Expired or transferred ENS ownership must fail closed.
- Do not trust query params, cached ENS values, Supabase ENS mirrors, or client-submitted wallet addresses.

### Market Discovery Model

- Dexscreener is the agent's market radar. Uniswap is the execution truth.
- The agent can inspect Dexscreener directly through Moonjoy MCP tools. Moonjoy validates only trade eligibility.
- For every candidate token the bot wants to trade:
  1. Bot finds token on Dexscreener.
  2. Bot calls Moonjoy `validate_candidate`.
  3. Moonjoy verifies `chainId=base`.
  4. Moonjoy requests a Uniswap quote.
  5. If quote succeeds, token can be added to the match allowlist.
  6. Bot may submit simulated trade using quote-backed execution.
- Post-processing enforces hard Moonjoy trading constraints: token is on Base, token address is valid, token can be quoted through Uniswap on Base, quote is fresh, and the match is live.
- Moonjoy should not silently remove candidates because they look risky, low-volume, new, or volatile unless that violates an explicit match rule. Instead return `riskWarnings`:
  - `low_liquidity`
  - `low_24h_volume`
  - `very_new_pair`
  - `concentrated_activity`
  - `no_uniswap_quote_available`
- Only `no_uniswap_quote_available` or `not_base` should block trade admission.

## Source Of Truth Rules

Moonjoy should look like a blockchain hackathon project, not a Web2 app with decorative chain calls. Before adding any table or column, classify the state:

```txt
Resolve from chain, never store as canonical DB state:
  ENS names
  ENS ownership
  ENS address records
  ENS text records
  agent identity
  wallet token balances outside the simulated match ledger
  token ownership
  escrow deposit status
  escrow settlement status
  transaction success or revert status

Store in DB as app workflow state:
  Privy user id
  embedded signer address from verified Privy linked accounts
  agent smart account address from verified Privy linked accounts
  MCP approval metadata
  offchain strategy drafts and manifests
  match invite state and lifecycle
  match state and lifecycle
  simulated wager locks before escrow exists
  Uniswap quote snapshots for replay
  simulated trade fills and per-match simulated token balances
  portfolio valuation snapshots
  audit receipts such as transaction hashes, if the route also verifies chain state
```

Rules:

- If a value can be resolved from Durin, token contracts, or the escrow contract, resolve it there at the gate where it matters.
- DB snapshots may support replay and UI speed, but they must not decide readiness unless they are freshened and verified against chain.
- Transaction hashes are receipts, not proof by themselves. Any route that accepts a hash must verify receipt success, target contract, calldata, and resulting onchain state.
- When the first demo uses simulated wager locks, keep that adapter explicitly marked as simulation-only. Once escrow exists, deposit and settlement readiness comes from the escrow contract.

## Partner Track Strategy

### Uniswap

Uniswap is the core trading layer.

Build:

- Fetch live Base quotes through the Uniswap API.
- Store quote request and response metadata for every simulated trade.
- Use quote outputs as deterministic simulated fills.
- Show route, routing type, token pair, amount, estimated output, gas estimate, and timestamp in the UI.
- Add `FEEDBACK.md` in the repo root before submission.

Do not build first:

- Real swap submission.
- Generalized token discovery across every Base token.
- Onchain settlement of trading positions.

### ENS

ENS is the core identity layer. Durin is the required implementation path for Moonjoy ENS subnames in the demo.

Build:

- User claims a Moonjoy ENS name, such as `buzz.moonjoy.eth`.
- The user's single agent later mints or claims an agent name, such as `agent-buzz.moonjoy.eth`, into the already-created agent smart wallet after MCP authorization.
- Use the deployed Durin setup in `/Users/george/Workspace/durin` and the Moonjoy ops notes in `docs/ens-durin-infrastructure.md`.
- Agent names resolve to agent-controlled addresses.
- ENS records are used for real product behavior: ownership, human-agent linkage, address discovery, strategy provenance, and public match history pointers.

Target records:

```txt
addr                 agent address
moonjoy:user         buzz.moonjoy.eth
moonjoy:strategy     active strategy manifest hash or CID
moonjoy:last_match   latest match id
moonjoy:stats        compact stats pointer
```

These records can be filled incrementally. User-owned text records can be written during user ENS setup. Agent records such as `addr`, `moonjoy:user`, and `moonjoy:strategy` belong after MCP authorization, when the agent can establish its own identity and default strategy. `moonjoy:last_match` and richer stats pointers should be written after matches exist.

Recommended `moonjoy:match_preference` JSON shape:

```json
{
  "duration": "any",
  "wagerUsd": "10",
  "capitalUsd": {
    "min": "any",
    "max": "250"
  }
}
```

Rules:
- `duration` supports `"any"` or a concrete duration in seconds such as `"300"` or `"600"`.
- `capitalUsd.min` and `capitalUsd.max` support `"any"` or concrete USD bounds.
- Challenge-link terms still override automatch preferences for a specific match.

Durin is not a stretch item. The demo should use the deployed Base Sepolia Durin registry and registrar for user and agent subnames. If the custom Moonjoy registrar upgrade is not ready, keep the first demo on the currently deployed Durin registrar, but do not replace Durin with cosmetic offchain ENS labels.

### KeeperHub

KeeperHub is a stretch partner track that fits strategy distribution and monetization.

Build after the base game works:

- Publish one or more private workflows as paid marketplace strategies through KeeperHub.
- Let other agents discover and pay to run those strategies without exposing the private workflow steps.
- Let an agent call KeeperHub strategies during warm-up or during the match.
- Track which KeeperHub workflow influenced each strategy decision.
- Store KeeperHub strategy listing ids, run ids, price, and earnings attribution where feasible.
- Show paid KeeperHub strategy usage in the match replay.

Candidate paid strategy workflows:

- Recovery Strategy: recover from bad positions.
- Go for Victory: aggressive risk-on trading.
- Crash Landing Strategy: reduce loss and preserve remaining value.
- Discover Tokens: find highly volatile candidate tokens.
- Rebalance to Base: move back into safer assets near match end.

KeeperHub should sit alongside the agent's default strategy. It should not replace Moonjoy's strategy model.

## System Shape

```txt
apps/web
  Next.js app
  Privy auth
  onboarding
  human invite creation and join flow
  scoped ENS invite validation
  match UI
  API routes
  Moonjoy MCP endpoint for assigned agent execution
  Dexscreener and Uniswap service adapters
  ENS, Privy, KeeperHub service adapters

apps/worker
  invite expiry
  match timers
  warm-up expiry
  quote polling
  settlement jobs

packages/game
  pure invite/match status rules where possible
  readiness rules
  scoring rules
  PnL calculation
  winner selection

supabase
  app workflow, invite, match, strategy, simulated trade, quote, and audit tables
  no canonical ENS, balance, ownership, escrow, or transaction-status mirrors

contracts
  future wager escrow and settlement contracts
```

`packages/game` must stay pure TypeScript. It should not import Next.js, Privy, Supabase, Uniswap, ENS, KeeperHub, environment variables, or filesystem APIs.

## Hard Dependency Chain

The implementation order should follow these blockers:

1. Privy auth, embedded signer creation, user record, one-agent-per-user record, and the agent smart account must come first.
2. User ENS setup requires the authenticated user and embedded signer, and should use the deployed Durin registry and registrar.
3. MCP authorization is a one-time approval that activates the external agent client after the user has a wallet foundation and user ENS identity. MCP authorization enables agent execution inside a human-approved match, not matchmaking authority.
4. Agent-owned identity and default strategy bootstrap happen after MCP authorization. The approved agent can mint or claim its derived ENS name and create or select its default strategy through Moonjoy tools.
5. Funding can be built independently of MCP authorization, but match invite creation and joining require only the demo wager path. Trading capital is fresh simulated USDC per match.
6. `packages/game` match constants, warm-up status, invite status rules, readiness terminology, and tests must be corrected before invite creation, join, live, or settlement flows depend on them.
7. Match invite and lifecycle must work before Uniswap quote-backed simulated trading is useful.
8. Portfolio scoring and replay must work before wager escrow and KeeperHub marketplace work.

## Privy Wallet Model

Moonjoy should create an agent smart account as part of user signup. The smart account is the single visible game wallet for the user's agent and the player address in matches. MCP authorization does not create the smart account, mint ENS names, or perform setup actions by itself. MCP authorization only approves an external agent client, such as Claude or Codex, to operate through Moonjoy's approved tools for that user's agent.

The human user owns the agent relationship and controls setup. The agent smart account owns the agent's public game identity, wager actions, trading actions, victories, stats, and match history. Strategies are user-owned records that can be assigned to the agent and attributed to the agent when used.

```txt
Human controller
  Privy user
  Privy embedded signer
  user wallet / user NFT owner
  resolves from: buzz.moonjoy.eth
  purpose: login, setup, funding, withdrawals, recovery, intent creation, strategy ownership

Agent smart account
  Privy smart wallet / ERC-4337 account
  created at: user signup
  assigned to: the user's single Moonjoy agent
  controlled by: human controller plus approved Moonjoy/agent execution authority
  resolves from: agent-buzz.moonjoy.eth
  purpose: wager deposits, simulated trading actions, agent ENS identity, reputation, victories, stats, achievements, KeeperHub payments

Approved external agent client
  Claude, Codex, or another MCP-capable agent
  authorized through: Moonjoy MCP auth
  purpose: use Moonjoy skill files, `.md` context, and MCP tools to decide what to do next, then take approved actions such as preparing strategies, submitting simulated trades, or recording strategy decisions

Agent execution authority
  Privy authorization key or key quorum
  scoped by policies where possible
  purpose: let the live agent act from the agent smart account during match flows
```

In Privy terms:

```txt
Moonjoy concept                 Privy primitive
Privy user                      user account
Human controller signer          embedded wallet / embedded signer
Agent player wallet              smart wallet / smart account
Agent wallet creation            automatic smart wallet creation during user signup
External agent authorization      Moonjoy MCP auth approval
Agent execution authority        authorization key / key quorum, where needed
Trade and wager guardrails       wallet policies, smart account permissions, backend checks
```

The server does not have one shared Moonjoy wallet. The server has one or more authorization keys or key quorums that can help control many distinct agent smart accounts. Each player still has an individual agent address because each agent gets its own smart account.

Hackathon default:

- Preconfigure Privy dashboard smart wallets for Base before implementation.
- Use one Moonjoy execution key quorum for agent automation if per-agent key quorums slow down the build.
- Create one distinct agent smart account when the user signs up.
- Store the agent smart account address on the agent record.
- Treat MCP authorization as external-agent approval only, not wallet provisioning or ENS minting.
- Let the approved agent decide its next action from Moonjoy skill files, `.md` context, and MCP state.
- After MCP authorization, let the approved agent mint or claim `agent-<human-name>.moonjoy.eth` and resolve it to the agent smart account address.
- Let the human fund and withdraw from the agent smart account.
- Have the agent smart account deposit the wager and execute or simulate trades.
- Enforce match rules in Moonjoy's backend and MCP layer.

Production direction:

- Use one key quorum or smart account module per agent for cleaner isolated execution authority.
- Use stricter policies or smart account permissions for token allowlists, contract allowlists, max notional, match expiry, and per-match capital limits.
- Let users pause the agent, rotate execution authority, withdraw funds, or disconnect the agent.

## Phase 0: Planning Baseline

Goal: lock the product model before building more runtime.

Deliverables:

- This execution strategy exists in `docs/planned-execution-strategy.md`.
- Existing `docs/architecture.md` remains the source for repo boundaries.
- Existing `packages/game` match and scoring rules are treated as the starting point.
- The game model is updated from the current 3-minute match constant to 5-minute matches before match lifecycle implementation begins.

Gate:

- The team agrees that one user has one agent, the agent smart wallet is created at signup, strategies are user-owned records assigned to agents, and strategy use is agent-attributed behavior rather than a match setup choice.

## Phase 1: Privy Auth And Agent Wallet Foundation

Goal: create the authenticated user, human signer, single agent record, and agent smart account before any game, ENS, MCP, funding, or match work depends on them.

This is the first implementation dependency. Nothing downstream should assume a playable user until this phase can reliably create and read the user's Privy identity, embedded signer, agent record, and agent smart account address.

Build:

- Add Privy authentication to `apps/web`.
- Create the authenticated user profile record.
- Create or link the user's Privy embedded signer.
- Store the embedded signer address for setup, recovery, funding, and withdrawal flows.
- Create one agent record for the user.
- Create one distinct Privy smart wallet for that agent during signup.
- Store the agent smart account address on the agent record.
- Track agent setup status separately from match readiness.
- Block ENS setup, MCP authorization, funding actions, strategy setup, and match creation until the authenticated user, embedded signer, agent record, and agent smart account all exist.
- Add explicit loading, empty, and error states for auth, signer creation, agent record creation, and smart wallet creation.

Data model:

```txt
users
  id
  privy_user_id
  embedded_signer_address
  created_at

agents
  id
  user_id
  smart_account_address
  setup_status
  status
  created_at
```

Gate:

- A signed-in user can reach a dashboard.
- A signed-in user has one active agent record.
- A signed-in user has one created agent smart account address.
- The app can distinguish incomplete setup from complete wallet provisioning.
- A signed-out user cannot access protected game setup or create a match.

## Phase 2: User ENS Identity

Goal: bind the human user to a functional Moonjoy ENS identity before agent authorization.

Build:

- Use the deployed Durin L2 registry and registrar from `docs/ens-durin-infrastructure.md`.
- Treat Durin names as functional product identity, not display-only labels.
- Add a claim flow for `*.moonjoy.eth`.
- Validate label availability.
- Resolve the claimed user name after registration.
- Do not store confirmed ENS names in the database. Resolve them from Durin by embedded signer address.
- Optionally write one safe public user text record for `moonjoy:match_preference`, containing automatch defaults for duration, bet amount, and trading-capital range.
- Do not cache user ENS text records in the database. Read `moonjoy:match_preference` from Durin when needed.
- Reserve agent identity, MCP discovery, strategy, stats, and match-history text record keys, but do not require them before the agent is authorized.
- Pay or sponsor setup gas through the human embedded signer, Privy/paymaster support, or another explicit setup sponsor. Do not require user-supplied trading capital before ENS setup.
- Display the user ENS name instead of raw addresses in primary UI.
- Leave agent ENS explicitly deferred until after MCP authorization so the agent can establish its own identity.

Data model changes:

```txt
No persistent ENS tables are required for Phase 2.
Durin is the source of truth for:
  user ENS name
  user ENS address resolution
  user ENS text records

Remove legacy local ENS cache fields/tables:
  users.ens_name
  agents.ens_name
  ens_claims
  ens_text_records
```

Gate:

- A signed-in user can claim or link a Moonjoy ENS name.
- The user's ENS name resolves to the user's embedded signer.
- The user can optionally write public user ENS text records.
- `moonjoy:match_preference` is usable by future automatch and does not replace challenge-link settings.
- The UI can resolve and display the user ENS name without hard-coded values.
- Agent ENS is not required for this phase.

## Phase 3: MCP Authorization And Agent Activation

Goal: the human user approves one external agent client so the agent can operate through Moonjoy tools.

The user approves the agent once through Moonjoy MCP. This approval activates the agent's operating context; it does not create the smart account, mint ENS names by itself, or force a backend-authored strategy. MCP authorization enables agent execution inside a human-approved match, not matchmaking authority. The agent never creates, discovers, accepts, or cancels match invites.

Build:

- Add Moonjoy MCP auth flow.
- Let the user approve one external agent client.
- Store MCP client metadata and approval status.
- Add Moonjoy skill or `.md` context instructions for Codex, Claude, opencode, or another MCP-capable agent.
- Explain how to authenticate to Moonjoy MCP.
- Explain that humans create and join invites through the web app. The agent only sees assigned match state and executes within that match.
- Keep MCP as the agent integration surface. Do not add a REST mirror unless MCP blocks the demo.
- Expose the approved agent's current user identity, wallet foundation, funding state, assigned match state, and next allowed execution actions through MCP.
- Treat funding tools as status-only until the funding phase exists.
- After authorization, allow the agent to use Moonjoy tools to bootstrap its identity and strategy in Phase 4.

Data model:

```txt
agents
  id
  user_id
  smart_account_address
  execution_signer_id
  mcp_client_name
  mcp_subject
  status
  created_at
```

Gate:

- A user with a complete Privy wallet setup and user ENS name can approve one external agent client.
- The approved agent uses the smart account created during signup.
- The approved external agent can read Moonjoy context and discover the next allowed execution actions.
- The user cannot approve a second active agent.
- Match invite creation and joining are still impossible until agent identity, default strategy, funding, and wager readiness are complete.
- MCP tools do not include invite creation, challenge acceptance, or matchmaking.

MCP tools:

```txt
moonjoy_status
  sections:
    identity
    readiness
    current_invite
    current_match
    portfolio
    leaderboard
    trade_history
    allowed_tokens
    all

moonjoy_match
  actions:
    heartbeat
    prepare
    mark_ready
    play_turn

moonjoy_strategy
  actions:
    list
    create
    update
    record_decision
    bootstrap_recommendation
    bootstrap_step
    bootstrap_run
    claim_identity

moonjoy_market
  actions:
    dexscreener_search
    dexscreener_token_pairs
    dexscreener_tokens
    dexscreener_boosts
    validate_candidate
    quote
    submit_trade
```

Deprecated or removed MCP actions:

```txt
moonjoy_match:auto       removed: agents never auto-matchmake
moonjoy_match:create     removed: humans create invites through the web app
moonjoy_match:accept     removed: humans join invites through the web app
moonjoy_match:cancel     removed: cancellation is human-only through the web app or authenticated API route
list open challenges     removed: agents do not browse open challenges
```

## Phase 4: Agent-Owned Identity And Strategy Bootstrap

Goal: the approved agent establishes its own public identity and default strategy before match flows depend on them.

Build:

- Use the deployed Durin L2 registry and registrar from `docs/ens-durin-infrastructure.md`.
- Let the approved agent mint or claim the derived agent ENS name, such as `agent-buzz.moonjoy.eth`, into the already-created agent smart account.
- Resolve the agent ENS name to the agent smart account address.
- Do not store the confirmed agent ENS name on the agent record. Resolve it from Durin by agent smart account address.
- Add required agent text records for address resolution, user linkage, and MCP discovery when supported.
- Add strategy records owned by users and assigned to agents.
- Let the approved agent create or select a default strategy so match play is possible without manual user strategy selection.
- Add strategy versions or revisions.
- Store source type: user prompt, `.md` context, agent-generated plan, KeeperHub workflow, or default behavior.
- Store the offchain strategy manifest body and local revision metadata in DB.
- Publish the active public strategy pointer in the agent ENS `moonjoy:strategy` text record after the default strategy manifest exists, if ENS text writes are enabled.
- When match readiness depends on public strategy identity, resolve `moonjoy:strategy` from the agent ENS record and verify it matches the selected local manifest.
- Let future agent actions mark decisions with the strategy or strategies used.
- Configure Moonjoy or agent execution authority so the live agent can act during match flows.
- Store the controlling execution signer or key quorum id if real automated wallet actions require it.
- Do not require a user-facing strategy picker.

Rules:

- A user may have only one active agent.
- A user has one active agent smart account.
- Agent identity is required before match creation.
- Agent identity is not a UI choice during match creation.
- The agent smart account is the game wallet and player address.
- Wagers, trading capital, Uniswap trades, victories, stats, and reputation attach to the agent smart account.
- Strategies are user-owned, assigned to the agent, and attributed to the agent smart account when used.
- Public strategy provenance belongs in the agent ENS record; the DB stores the authored strategy content and replay attribution.
- The human can fund or withdraw from the agent smart account.
- MCP authorization is external-agent approval only. Agent ENS and strategy setup are explicit agent actions after approval, not hidden authorization side effects.
- After authorization, the agent uses Moonjoy skill files, `.md` context, and MCP tools to decide and execute identity and strategy bootstrap. The agent does not create, discover, accept, or cancel match invites.

Data model:

```txt
strategies
  id
  user_id
  agent_id
  agent_smart_account_address
  name
  source_type
  manifest_body
  local_revision
  status
  created_at

strategy_decisions
  id
  strategy_id
  match_id
  trade_id
  rationale
  created_at
```

Gate:

- The approved agent has a derived ENS name.
- The agent ENS name resolves to the already-created agent smart account address.
- The agent has one active default strategy.
- Strategy records point to the owning user and the assigned agent smart account.
- If the active strategy is published publicly, the agent ENS `moonjoy:strategy` text record resolves to the selected strategy pointer.
- Strategy create and update tools operate through the approved MCP context.
- Match creation and joining are impossible until the one-time MCP approval exists.
- Match creation and joining are impossible until agent ENS identity and default strategy exist.

## Phase 5: Agent Funding And Readiness

Goal: make the agent smart account usable before the user creates a match invite.

Funding is not required to approve an external MCP client. Funding is required before invite creation or match join.

Build:

- Show the agent smart account address and resolve the agent ENS name from Durin.
- Let the user fund the agent smart account directly.
- Let the user withdraw from the agent smart account when no live match blocks withdrawal.
- Read wager funding state at the readiness gate.
- Initialize simulated match trading capital as USDC from `starting_capital_usd`.
- Read whether the fixed $10 wager can be covered separately from simulated trading capital.
- Add a simulated wager deposit ledger for the first demo.
- Lock the creator's $10 wager in the simulated ledger before the invite row is created.
- Lock the joiner's $10 wager in the simulated ledger before the joiner can accept the invite.
- Make deposit creation atomic with invite creation or invite acceptance so no playable match exists without the required lock.
- Keep the simulated deposit service behind an adapter that can later be replaced by the escrow contract deposit.
- Do not store funding balances, funding events, or token ownership as canonical readiness state.
- Store balance snapshots only as optional audit/debug records, and never use stale snapshots to pass readiness.
- Keep backend checks for future real trades:
  - authenticated user controls the agent,
  - agent is live,
  - match is in warm-up or live state as required,
  - action is within chain, token, contract, notional, and expiry limits.

Data model:

```txt
wager_deposits
  id
  user_id
  agent_id
  match_id
  smart_account_address
  amount_usd
  mode
  status
  transaction_hash_receipt
  created_at
```

`wager_deposits` is canonical only while `mode = simulated`. When `mode = escrow`, the escrow contract is canonical and this table stores only app linkage plus receipt hashes.

Gate:

- The user can see the agent smart account address and agent ENS name.
- The user can fund the agent smart account.
- The user can withdraw from the agent smart account outside locked match flows.
- Moonjoy can initialize each player's simulated match capital as USDC.
- Moonjoy can tell whether the simulated wager deposit can be recorded without depending on residual trading tokens.

## Phase 6: Game Rules Baseline And Match Readiness Gate

Goal: correct the pure game rules, add invite status rules, and make every match precondition explicit before invite creation exists.

Build:

- Update `packages/game` from the current 3-minute match constant to the 5-minute product default.
- Add an explicit warm-up lifecycle status before `live`.
- Replace legacy readiness language such as wallet delegation with agent smart account readiness and execution authority.
- Add invite status rules: `open`, `joined`, `revoked`, `expired`.
- Add scoped invite validation rules: ENS normalization, Durin resolution at join time, expired/transferred ownership fails closed.
- Add or update tests for duration constants, warm-up transitions, available actions, readiness rules, and invite status transitions.
- Add one readiness service or route that checks all match prerequisites in one place.
- Return specific missing requirements instead of a single generic failure.
- Require:
  - authenticated Privy user,
  - embedded human signer,
  - one active agent record,
  - one agent smart account address,
  - user ENS identity resolved from Durin,
  - agent ENS identity resolved from Durin to the agent smart account,
  - one-time approved external agent client through Moonjoy MCP,
  - agent execution authority when needed,
  - default strategy, plus matching agent ENS `moonjoy:strategy` pointer when public strategy provenance is enabled,
  - enough separate wager funds, verified from current chain balances before deposit,
  - enough value in the curated Base trading asset set, verified from current chain balances.
- Show readiness status in the setup UI before the user attempts invite creation.
- Invite creation records the creator's deposit after readiness passes and before creating the invite row.
- Invite joining records the joiner's deposit after readiness passes and before accepting the invite.

Gate:

- `packages/game` exposes the correct 5-minute duration, warm-up lifecycle, and agent smart account readiness terminology.
- Pure game rule tests pass before route handlers or worker jobs depend on the lifecycle.
- The UI can explain exactly why a user can or cannot create or join a match.
- Match creation and join flows call the same readiness check.
- Readiness checks do not pass from cached ENS, cached balances, or cached escrow state.
- No match row is created for a user whose setup is incomplete.

## Phase 7: Human Invite Link Creation

Goal: authenticated humans create match invites through the web app. Agents never create, discover, or accept invites.

Build:

- Invite creator must be authenticated.
- Invite creator must have a user ENS name resolved from Durin.
- Invite creator must have an agent ENS identity resolved from Durin and one-time approved external agent client through Moonjoy MCP.
- Invite creator must have a funded, live agent smart account verified by current chain balance reads.
- Invite creator must record the $10 wager deposit before the invite is created.
- Create an invite with terms:
  - `scope_type`: `open` or `ens`.
  - If `ens`, `scoped_ens_name` must be a normalized ENS name.
  - $10 wager.
  - 5-minute trading window.
  - warm-up stage before the live clock.
  - highest normalized PnL wins.
- Generate an opaque invite token. The shareable link carries only the invite token, not trusted state.
- Invite terms are stored server-side in the `match_invites` table.
- The joiner must satisfy the same identity, MCP approval, funding, and wager deposit requirements as the creator.
- For `ens`-scoped invites, the joiner must prove authenticated control of the scoped ENS through Durin at join time. Do not trust query params, cached ENS values, Supabase ENS mirrors, or client-submitted wallet addresses.
- Neither player chooses an agent or strategy because those are already attached to the user.
- In the first demo, the wager deposit is a simulated backend ledger lock. When the escrow contract is ready, replace that deposit adapter with the contract deposit without changing the invite creation boundary.
- After escrow exists, invite creation and join verify deposit state from the escrow contract, not from the DB row.
- When the joiner completes invite acceptance, the match is created and enters warm-up. Both agents receive the assigned match through MCP.
- Cancellation is human-only through the web app or an authenticated API route, not as an agent MCP action.

Data model:

```txt
match_invites
  id
  created_by_user_id
  creator_agent_id
  invite_token
  scope_type: open | ens
  scoped_ens_name
  wager_usd
  duration_seconds
  warmup_seconds
  status: open | joined | revoked | expired
  created_match_id
  created_at
  expires_at

matches
  id
  invite_id
  status
  wager_usd
  duration_seconds
  warmup_seconds
  scoring_method
  creator_wager_deposit_id
  created_by_user_id
  created_at
  starts_at
  ends_at
  settled_at

match_seats
  id
  match_id
  user_id
  agent_id
  agent_smart_account_address
  role
  starting_value_usd
  ending_value_usd
  pnl_usd
  pnl_percent
```

Gate:

- A valid user can create an open or ENS-scoped invite.
- Another valid user can join the invite through the opaque token link.
- For ENS-scoped invites, only the authenticated controller of the scoped ENS can join.
- Expired, revoked, or already-joined invites cannot be joined.
- Both seats have live agent smart accounts.
- The creator's wager deposit exists before the invite exists.
- The joiner's wager deposit exists before the invite is accepted.
- Neither player selects an agent or strategy during invite creation or joining.
- No MCP tool exists for creating, accepting, or cancelling invites.

## Phase 8: Warm-Up Stage

Goal: give agents time to inspect state and prepare before the trading clock starts. Agents enter warm-up only after both humans have joined the invite and the match has been created.

Build:

- Add `warmup` or equivalent status to the match lifecycle.
- During warm-up, agents may:
  - fetch assigned match state through MCP,
  - inspect available capital from current chain reads,
  - discover market opportunities through Dexscreener MCP tools,
  - request Uniswap quotes for candidate tokens through `validate_candidate`,
  - create or update strategies,
  - verify smart account funding from current chain reads,
  - mark readiness for live start,
  - call KeeperHub strategy workflows if enabled.
- During warm-up, agents may not submit simulated trades.
- When both agents are ready or the warm-up timer expires, the match becomes live.

Gate:

- Warm-up is visible in UI.
- Agent actions during warm-up are audited.
- No trade can be accepted before live start.

## Phase 9: Uniswap Quote-Backed Simulated Trading

Goal: make trading feel real while remaining deterministic. Dexscreener is the agent's market radar. Uniswap is the execution truth.

Build:

- Add a Uniswap service adapter.
- Add a Dexscreener service adapter for market discovery.
- Use Base token addresses and known supported tokens first.
- Expose Dexscreener search, token pairs, token data, and boosts as MCP market tools:
  - `dexscreener_search`: returns Dexscreener search results with minimal normalization.
  - `dexscreener_token_pairs`: returns pools for a token on Base.
  - `dexscreener_tokens`: returns pair data for up to 30 token addresses on Base.
  - `dexscreener_boosts`: returns boosted token feeds, optionally filtered to chainId=base.
- Dexscreener results should include fields such as: chainId, dexId, pairAddress, baseToken, quoteToken, priceUsd, liquidity, volume, txns, priceChange, pairCreatedAt, url, boosts, info.
- Add `validate_candidate` MCP action that checks chainId=base and requests a Uniswap quote. If quote succeeds, token can be added to the match allowlist.
- Return `riskWarnings` for candidates: low_liquidity, low_24h_volume, very_new_pair, concentrated_activity, no_uniswap_quote_available.
- Only `no_uniswap_quote_available` or `not_base` should block trade admission.
- Request Uniswap quotes for proposed agent trades.
- Persist the full quote metadata needed for replay.
- Convert successful quotes into simulated fills.
- Reject trades when quote retrieval fails, quote is stale, liquidity is insufficient, or the match is not live.
- Attribute every quote and fill to the agent smart account.
- For real execution later, submit transactions from the agent smart account.

Data model:

```txt
quote_snapshots
  id
  match_id
  agent_id
  agent_smart_account_address
  request_id
  token_in
  token_out
  amount_in
  amount_out
  routing
  route_summary
  gas_estimate
  raw_response
  created_at

simulated_trades
  id
  match_id
  agent_id
  agent_smart_account_address
  quote_snapshot_id
  token_in
  token_out
  amount_in
  amount_out
  status
  created_at
```

Gate:

- Agents can trade only through quote-backed simulation.
- Every fill can be replayed from stored data.
- The UI can explain why each trade happened and which strategy influenced it.
- Agent smart account identity, strategy attribution, wager, and trading actions stay unified.

## Phase 10: Portfolio Scoring And Settlement

Goal: finish matches fairly and visibly.

Build:

- Snapshot each player's starting portfolio value at live start.
- Snapshot ending value at match end.
- Calculate PnL USD and PnL percentage.
- Select the winner by PnL percentage.
- Use raw PnL USD as supporting context, not the winner criterion.
- Record simulated wager settlement intent after the grace window.
- Pay wager winnings to the winning agent smart account when escrow is enabled.
- Attribute match win, strategy performance, and skill history to the winning agent smart account.
- Publish public match-history or stats pointers to agent ENS when enabled; do not treat a DB profile row as public reputation.
- The human can withdraw from the agent smart account after settlement.
- Keep settlement state explicit: pending, settling, complete, failed.

Gate:

- A completed match has deterministic scores.
- The winner can be explained from stored portfolio snapshots.
- Simulated wager settlement is recorded for later escrow wiring, or escrow settlement is verified from contract state with a clear retry path.

## Phase 11: Wager Escrow Contract

Goal: make the $10 wager credible without coupling it to trading capital.

Build:

- Add a minimal escrow contract after the simulated wager deposit and offchain match flow are clear.
- Replace the simulated wager deposit adapter with a real escrow deposit adapter.
- Both agents deposit the fixed wager from their agent smart accounts.
- The contract records match id, two agent smart account addresses, amount, and status.
- Read deposit, refund, and settlement status from the escrow contract. The database may store transaction hashes and match linkage, but not canonical escrow state.
- The backend submits or proves the winner for the hackathon version.
- Keep demo trading capital in the per-match simulated ledger outside the wager escrow.
- The human user creates the match intent, but the agent performs the wager deposit.

Initial contract responsibilities:

```txt
createMatchEscrow(matchId, agentA, agentB, wagerToken, wagerAmount)
deposit(matchId)
cancelBeforeStart(matchId)
settle(matchId, winner)
refund(matchId)
```

Restraint:

- Do not build complex dispute resolution first.
- Do not settle simulated trades onchain.
- Do not require the contract to know strategy or quote details.

Gate:

- Both agents can lock the $10 wager from their smart accounts.
- The system can settle the wager to the winning agent smart account in a demo-safe way.
- Wager custody is visibly separate from active trading capital.

## Phase 12: KeeperHub Strategy Marketplace

Goal: add partner-track depth without weakening the core game.

Build:

- Integrate KeeperHub after default strategy execution works.
- Publish private workflows as paid marketplace strategies:
  - Recovery Strategy.
  - Go for Victory.
  - Crash Landing Strategy.
  - Discover Tokens.
  - Rebalance to Base.
- Keep private workflow steps hidden from strategy buyers.
- Let other agents discover, pay for, and run published KeeperHub strategies.
- Let agents call these strategies during warm-up or during the live match.
- Store marketplace listing id, workflow id, execution id, price, output, and strategy decision linkage.
- If KeeperHub payment or ownership is onchain, verify it from chain and store only run linkage or receipt hashes locally.
- Let the agent smart account pay for strategy runs and receive attribution or earnings where feasible.
- Show paid strategy usage in match replay.

Gate:

- KeeperHub use is visible and meaningful.
- The match still works if KeeperHub is disabled.

## Phase 13: Demo And Submission Polish

Goal: make the project legible to judges.

Build:

- Arena UI with timer, warm-up status, agent identities, trade feed, Uniswap routes, strategy decisions, PnL, and final winner.
- Invite creation UI for open and ENS-scoped invites.
- Invite join UI with scoped ENS validation feedback.
- Agent profile page with ENS identity, strategy list, and performance stats.
- Match replay page with quote provenance.
- Dexscreener market discovery results in the agent trading interface.
- `FEEDBACK.md` for Uniswap.
- README setup and architecture section.
- Short demo script and recorded walkthrough.

Gate:

- A judge can understand:
  - how humans create and accept match invites through the web app,
  - how agents execute trades inside human-approved matches through MCP,
  - how Dexscreener is the agent's market radar and Uniswap is the execution truth,
  - how ENS gates identity and scoped invites,
  - how Privy gives every user an agent smart account at signup,
  - how MCP authorization approves an external agent client without provisioning a wallet or performing setup actions,
  - how the approved agent uses Moonjoy context and tools to choose post-auth actions,
  - how the human creates intent while the agent account makes wagers and trades,
  - how KeeperHub can publish private workflows as paid marketplace strategies,
  - why the $10 wager is separate from trading capital,
  - why normalized PnL determines the winner.

## First Implementation Order

1. Preconfigure Privy dashboard smart wallets for Base.
2. Add Privy auth and user signup in `apps/web`.
3. Create or link the human embedded signer.
4. Create the one-agent-per-user record and Privy agent smart wallet during signup.
5. Store the human embedded signer address separately from the agent smart account address.
6. Block downstream setup until the authenticated user, embedded signer, agent record, and agent smart account all exist.
7. Fix `packages/game` match duration, warm-up lifecycle, invite status rules, readiness terminology, and tests before route or worker code depends on those rules.
8. Add Durin-backed user ENS claim/link flow and safe public user text records.
9. Add MCP authorization for external agent clients, plus Moonjoy skill/context for post-auth action selection. MCP enables agent execution inside a human-approved match, not matchmaking authority.
10. Let the approved agent mint or claim its derived ENS identity into the already-created agent smart wallet.
11. Add user-owned strategy registry assigned to agents, including an agent-created or agent-selected default strategy.
12. Update the agent ENS strategy text record after the default strategy manifest exists, if text writes are enabled.
13. Add agent funding display, withdrawal entry points, simulated wager deposit locking, and per-match USDC ledger initialization for trading capital.
14. Add a match readiness service used by invite create and join flows, with one-time MCP approval required.
15. Add human invite creation flow: open and ENS-scoped invites with opaque tokens, server-side terms, creator wager lock.
16. Add human invite join flow: invite loading by opaque token, scoped ENS validation through Durin, joiner readiness checks, joiner wager lock, match creation and warm-up start.
17. Add invite expiry in worker.
18. Add Uniswap quote-backed simulated trades.
19. Add Dexscreener market discovery MCP tools and validate_candidate action.
20. Add scoring and replay UI.
21. Add wager escrow contract.
22. Add KeeperHub paid marketplace strategy workflows.
23. Add submission docs and demo polish.

## Deliberate Simplifications

- Start with one chain: Base.
- Start with a curated Base trading asset set for match capital and quote-backed simulated trades.
- Start with Dexscreener for market discovery and Uniswap for execution validation.
- Start with simulated fills from Uniswap quotes.
- Start with one active agent per user.
- Start with one agent smart account per user, created during signup.
- Start with one Moonjoy execution key quorum if per-agent execution keys slow down the hackathon.
- Start with one fixed wager amount.
- Start with human invite links as the only match entry point. No automatch, no agent-driven matchmaking.
- Start with backend-authorized escrow settlement.
- Start with simple user-owned strategy manifests before richer strategy analytics.
- Start with KeeperHub as optional paid marketplace strategy source, not required match infrastructure.
- Start with risk warnings on Dexscreener candidates rather than silent filtering.

## Risks

- Durin registrar work is required for submission. Use the already deployed Durin registry and registrar first, and only take on the custom Moonjoy registrar upgrade if it does not block the playable loop.
- Uniswap API rate limits require caching and throttling.
- External agents may fail to call tools reliably.
- Wager escrow can become a time sink if built before the offchain game loop is stable.
- PnL fairness is easy to miscommunicate if raw dollar PnL is emphasized over percentage PnL.
- KeeperHub can distract from the stronger Uniswap and ENS prize narratives if added too early.

## Current Repo Fit

The existing repo already supports this direction:

- `apps/web` is the right place for Privy, ENS, MCP, Uniswap, and UI work during the hackathon.
- `apps/worker` exists and can later own timers, polling, and settlement retries.
- `packages/game` already owns match readiness and PnL helpers.
- `docs/architecture.md` already defines the correct dependency direction.
- `supabase/migrations` exists and is the right place for sequential schema additions.
