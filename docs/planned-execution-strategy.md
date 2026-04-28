# Moonjoy Planned Execution Strategy

This plan is intentionally sequential. Each phase has one main outcome and a gate that must be true before the next phase starts. Hackathon speed matters, but the implementation should still preserve correctness, clarity, and restraint.

## Product Decisions

- Moonjoy is a wagered PvP agent trading game.
- The default match duration is 5 minutes.
- Every match has a warm-up stage before the trading clock starts.
- The wager is fixed at $10 for the first demo version.
- The wager is separate from each user's trading capital.
- Users may bring and deploy trading capital from a curated Base asset set.
- The winner is the player with the best normalized PnL over the match window.
- For fairness, the primary score should be PnL percentage from each player's starting marked portfolio value, not raw dollar PnL.
- A player is a user plus that user's single Moonjoy agent.
- A user always has exactly one agent.
- There is no agent selection during match setup.
- There is no manual strategy selection during match setup.
- A user may own one or more strategies that the user's agent can use during a match.
- Strategy choice is part of the agent's autonomous behavior and must be attributable after the match.
- The human user creates game intent and controls setup.
- The user must approve the agent once through Moonjoy MCP before creating or joining matches.
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
- The authenticated user's single agent mints or claims an agent name, such as `agent-buzz.moonjoy.eth`, into the already-created agent smart wallet.
- Use the deployed Durin setup in `/Users/george/Workspace/durin` and the Moonjoy ops notes in `docs/ens-durin-infrastructure.md`.
- Agent names resolve to agent-controlled addresses.
- ENS records are used for real product behavior: ownership, agent discovery, MCP endpoint discovery, strategy provenance, and public match history pointers.

Target records:

```txt
addr                 agent address
avatar               agent image or generated profile asset
moonjoy:user         buzz.moonjoy.eth
moonjoy:mcp          https://moonjoy.app/mcp
moonjoy:strategy     active strategy manifest hash or CID
moonjoy:last_match   latest match id
moonjoy:stats        compact stats pointer
```

These records can be filled incrementally. `addr`, `moonjoy:user`, and `moonjoy:mcp` belong with identity setup. `moonjoy:strategy` should be written after the default strategy exists. `moonjoy:last_match` and richer stats pointers should be written after matches exist.

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
  match UI
  API routes
  Moonjoy MCP endpoint
  Uniswap, ENS, Privy, KeeperHub service adapters

apps/worker
  match timers
  warm-up expiry
  quote polling
  autonomous agent loop coordination
  settlement jobs

packages/game
  pure match rules
  readiness rules
  scoring rules
  PnL calculation
  winner selection

supabase
  user, agent, strategy, match, trade, quote, and audit tables

contracts
  future wager escrow and settlement contracts
```

`packages/game` must stay pure TypeScript. It should not import Next.js, Privy, Supabase, Uniswap, ENS, KeeperHub, environment variables, or filesystem APIs.

## Hard Dependency Chain

The implementation order should follow these blockers:

1. Privy auth, embedded signer creation, user record, one-agent-per-user record, and the agent smart account must come first.
2. User and agent ENS setup requires the already-created agent smart account address and should use the deployed Durin registry and registrar.
3. The default strategy record requires the agent record and smart account address. ENS strategy text records can only be finalized after this exists.
4. MCP authorization is a one-time required approval before match creation or joining. It requires a provisioned wallet, user identity, agent identity, and default strategy. It must not provision wallets, mint ENS names, or create the first strategy as an auth side effect.
5. Funding can be built independently of MCP authorization, but match creation and joining require a depositable $10 wager plus enough curated trading capital. The create and join endpoints must record the wager deposit before creating the match or accepting the seat.
6. `packages/game` match constants, warm-up status, readiness terminology, and tests must be corrected before match creation, join, live, or settlement flows depend on them.
7. Match lifecycle must work before Uniswap quote-backed simulated trading is useful.
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
  purpose: wager deposits, trading capital, Uniswap trades, agent ENS identity, reputation, victories, stats, achievements, KeeperHub payments

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
- Resolve `agent-<human-name>.moonjoy.eth` to the agent smart account address.
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
  ens_name
  created_at

agents
  id
  user_id
  smart_account_address
  setup_status
  ens_name
  status
  created_at
```

Gate:

- A signed-in user can reach a dashboard.
- A signed-in user has one active agent record.
- A signed-in user has one created agent smart account address.
- The app can distinguish incomplete setup from complete wallet provisioning.
- A signed-out user cannot access protected game setup or create a match.

## Phase 2: User And Agent ENS Identity

Goal: bind both the human user and the already-created agent smart account to functional Moonjoy ENS identities.

Build:

- Use the deployed Durin L2 registry and registrar from `docs/ens-durin-infrastructure.md`.
- Treat Durin names as functional product identity, not display-only labels.
- Add a claim flow for `*.moonjoy.eth`.
- Validate label availability.
- Resolve the claimed user name after registration.
- Store the user's ENS name in the user profile.
- Mint or claim the derived agent ENS name, such as `agent-buzz.moonjoy.eth`, into the already-created agent smart account.
- Resolve the agent ENS name to the agent smart account address.
- Store the agent ENS name on the agent record.
- Add required agent text records for address resolution, user linkage, and MCP discovery when supported.
- Reserve strategy, stats, and match-history text record keys, but do not require final values before strategy and match records exist.
- Pay or sponsor setup gas through the human embedded signer, Privy/paymaster support, or another explicit setup sponsor. Do not require user-supplied trading capital before ENS setup.
- Display user and agent ENS names instead of raw addresses in primary UI.
- Treat ENS minting or claiming as an explicit setup action, not as a side effect of MCP authorization.

Data model changes:

```txt
ens_claims
  id
  user_id
  agent_id
  ens_name
  claim_type
  owner_address
  resolver_address
  transaction_hash
  status
  created_at

ens_text_records
  id
  ens_name
  record_key
  record_value
  transaction_hash
  status
  created_at
```

Gate:

- A signed-in user can claim or link a Moonjoy ENS name.
- The user's single agent has a derived ENS name.
- The agent ENS name resolves to the already-created agent smart account address.
- The UI can resolve and display user and agent names without hard-coded values.

## Phase 3: Strategy Registry And Default Strategy

Goal: users can own strategy records that their single agent can use with attribution before any MCP tools or match flows try to reference strategies.

Build:

- Add strategy records owned by users and assigned to agents.
- Add a default strategy for every agent so match play is possible without user customization.
- Add strategy versions or revisions.
- Store source type: user prompt, `.md` context, agent-generated plan, KeeperHub workflow, or default strategy.
- Store a strategy manifest hash.
- Update the agent ENS `moonjoy:strategy` text record after the default strategy manifest exists, if ENS text writes are enabled.
- Let future agent actions mark decisions with the strategy or strategies used.
- Do not require a user-facing strategy picker.

Data model:

```txt
strategies
  id
  user_id
  agent_id
  agent_smart_account_address
  name
  source_type
  manifest_hash
  body
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

- A user can have multiple strategies.
- Every agent has one active default strategy.
- Strategy records point to the owning user and the assigned agent smart account.
- A trade or decision can be attributed to one or more strategies once trades exist.

## Phase 4: Agent MCP Authorization And Operating Context

Goal: an external agent client can safely operate the user's already-created, identified, and strategy-backed Moonjoy agent.

The user approves the agent once through Moonjoy MCP. Match creation and joining are blocked until this approval exists.

Build:

- Add Moonjoy MCP auth flow.
- Let the user approve one external agent client.
- Store MCP client metadata and approval status.
- Add a Moonjoy skill or `.md` context instructions for Codex, Claude, opencode, or another agent.
- Explain how to authenticate to Moonjoy MCP.
- Explain the match lifecycle and allowed tools.
- Keep MCP as the agent integration surface. Do not add a REST mirror unless MCP blocks the demo.
- Expose the approved agent's current identity, wallet, ENS, funding, match, portfolio, and strategy state through MCP.
- Treat funding tools as status-only until the funding phase exists.
- Define strategy setup instructions: user chats with the agent, the agent creates or updates strategies, and Moonjoy records provenance.
- Configure Moonjoy or agent execution authority so the live agent can act during match flows.
- Store the controlling execution signer or key quorum id if real automated wallet actions require it.

Rules:

- A user may have only one active agent.
- A user has one active agent smart account.
- Agent identity is required before match creation.
- Agent identity is not a UI choice during match creation.
- The agent smart account is the game wallet and player address.
- Wagers, trading capital, Uniswap trades, victories, stats, and reputation attach to the agent smart account.
- Strategies are user-owned, assigned to the agent, and attributed to the agent smart account when used.
- The human can fund or withdraw from the agent smart account.
- MCP authorization is external-agent approval only. It is not smart wallet creation, ENS minting, or strategy creation.
- After authorization, the agent uses Moonjoy skill files, `.md` context, and MCP tools to decide and execute the next allowed action.

Data model:

```txt
agents
  id
  user_id
  smart_account_address
  execution_signer_id
  ens_name
  mcp_client_name
  mcp_subject
  status
  created_at
```

Gate:

- A user with a complete Privy wallet setup, user ENS name, agent ENS name, and default strategy can approve an external agent client.
- The approved agent uses the smart account created during signup.
- The approved external agent can read Moonjoy context and discover the next allowed actions.
- Strategy create and update tools operate against already-existing strategy tables.
- Match creation and joining are impossible until the one-time MCP approval exists.
- The user cannot approve a second active agent.

MCP tools:

```txt
moonjoy_get_identity
moonjoy_get_match_state
moonjoy_get_portfolio
moonjoy_get_market_quote
moonjoy_submit_simulated_trade
moonjoy_create_strategy
moonjoy_update_strategy
moonjoy_list_strategies
moonjoy_record_strategy_decision
```

## Phase 5: Agent Funding And Readiness

Goal: make the agent smart account usable before the user creates a match.

Funding is not required to approve an external MCP client. Funding is required before match creation or match join.

Build:

- Show the agent smart account address and ENS name to the user.
- Let the user fund the agent smart account directly.
- Let the user withdraw from the agent smart account when no live match blocks withdrawal.
- Track available agent capital.
- Track whether the agent has enough value in the curated Base trading asset set to enter a match.
- Track whether the fixed $10 wager can be covered separately from trading capital.
- Add a simulated wager deposit ledger for the first demo.
- Lock the creator's $10 wager in the simulated ledger before a match row or shareable match link is created.
- Lock the opponent's $10 wager in the simulated ledger before the opponent can join.
- Make deposit creation atomic with match creation or seat acceptance so no playable match exists without the required lock.
- Keep the simulated deposit service behind an adapter that can later be replaced by the escrow contract deposit.
- Keep backend checks for future real trades:
  - authenticated user controls the agent,
  - agent is live,
  - match is in warm-up or live state as required,
  - action is within chain, token, contract, notional, and expiry limits.

Data model:

```txt
agent_account_events
  id
  user_id
  agent_id
  smart_account_address
  event_type
  amount_usd
  token_address
  transaction_hash
  created_at

wager_deposits
  id
  user_id
  agent_id
  match_id
  smart_account_address
  amount_usd
  mode
  status
  transaction_hash
  created_at
```

Gate:

- The user can see the agent smart account address and agent ENS name.
- The user can fund the agent smart account.
- The user can withdraw from the agent smart account outside locked match flows.
- Moonjoy can read the agent's available match capital.
- Moonjoy can tell whether the simulated wager deposit can be recorded and curated trading capital is ready.

## Phase 6: Game Rules Baseline And Match Readiness Gate

Goal: correct the pure game rules and make every match precondition explicit before match creation exists.

Build:

- Update `packages/game` from the current 3-minute match constant to the 5-minute product default.
- Add an explicit warm-up lifecycle status before `live`.
- Replace legacy readiness language such as wallet delegation with agent smart account readiness and execution authority.
- Add or update tests for duration constants, warm-up transitions, available actions, and readiness rules.
- Add one readiness service or route that checks all match prerequisites in one place.
- Return specific missing requirements instead of a single generic failure.
- Require:
  - authenticated Privy user,
  - embedded human signer,
  - one active agent record,
  - one agent smart account address,
  - user ENS identity,
  - agent ENS identity resolving to the agent smart account,
  - one-time approved external agent client through Moonjoy MCP,
  - agent execution authority when needed,
  - default strategy,
  - enough separate wager funds to record the $10 deposit,
  - enough value in the curated Base trading asset set.
- Show readiness status in the setup UI before the user attempts match creation.
- Match creation records the creator's deposit after readiness passes and before creating the match row.
- Match join records the opponent's deposit after readiness passes and before accepting the opponent seat.

Gate:

- `packages/game` exposes the correct 5-minute duration, warm-up lifecycle, and agent smart account readiness terminology.
- Pure game rule tests pass before route handlers or worker jobs depend on the lifecycle.
- The UI can explain exactly why a user can or cannot create or join a match.
- Match creation and join flows call the same readiness check.
- No match row is created for a user whose setup is incomplete.

## Phase 7: Match Creation With Wager Terms

Goal: authenticated users with a one-time MCP-approved agent can deposit the demo wager and create wagered match links.

Build:

- Match creator must be authenticated.
- Match creator must have a claimed ENS name.
- Match creator must have a resolved agent identity and one-time approved external agent client through Moonjoy MCP.
- Match creator must have a funded, live agent smart account.
- Match creator must record the $10 wager deposit before the match is created.
- Create a match with fixed default terms:
  - $10 wager.
  - 5-minute trading window.
  - warm-up stage before the live clock.
  - highest normalized PnL wins.
- The user creates match intent; the agent performs the match actions.
- Generate a shareable match link.
- Opponent joins only after satisfying the same identity, MCP approval, funding, and wager deposit requirements.
- Neither player chooses an agent or strategy because those are already attached to the user.
- In the first demo, the wager deposit is a simulated backend ledger lock. When the escrow contract is ready, replace that deposit adapter with the contract deposit without changing the match creation boundary.

Data model:

```txt
matches
  id
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

- A valid user can create a match link.
- Another valid user can join the link.
- Both seats have live agent smart accounts.
- The creator's wager deposit exists before the match exists.
- The opponent's wager deposit exists before the opponent seat is accepted.
- Neither player selects an agent or strategy during match setup.

## Phase 8: Warm-Up Stage

Goal: give agents time to inspect state and prepare before the trading clock starts.

Build:

- Add `warmup` or equivalent status to the match lifecycle.
- During warm-up, agents may:
  - fetch match state,
  - inspect available capital,
  - fetch market quotes,
  - create or update strategies,
  - verify smart account funding,
  - call KeeperHub strategy workflows if enabled.
- During warm-up, agents may not submit simulated trades.
- When both agents are ready or the warm-up timer expires, the match becomes live.

Gate:

- Warm-up is visible in UI.
- Agent actions during warm-up are audited.
- No trade can be accepted before live start.

## Phase 9: Uniswap Quote-Backed Simulated Trading

Goal: make trading feel real while remaining deterministic.

Build:

- Add a Uniswap service adapter.
- Use Base token addresses and known supported tokens first.
- Request quotes for proposed agent trades.
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
- The human can withdraw from the agent smart account after settlement.
- Keep settlement state explicit: pending, settling, complete, failed.

Gate:

- A completed match has deterministic scores.
- The winner can be explained from stored portfolio snapshots.
- Simulated wager settlement is recorded for later escrow wiring, or completed with a clear retry path when escrow is enabled.

## Phase 11: Wager Escrow Contract

Goal: make the $10 wager credible without coupling it to trading capital.

Build:

- Add a minimal escrow contract after the simulated wager deposit and offchain match flow are clear.
- Replace the simulated wager deposit adapter with a real escrow deposit adapter.
- Both agents deposit the fixed wager from their agent smart accounts.
- The contract records match id, two agent smart account addresses, amount, and status.
- The backend submits or proves the winner for the hackathon version.
- Keep trading capital in the agent smart account outside the wager escrow.
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
- Let the agent smart account pay for strategy runs and receive attribution or earnings where feasible.
- Show paid strategy usage in match replay.

Gate:

- KeeperHub use is visible and meaningful.
- The match still works if KeeperHub is disabled.

## Phase 13: Demo And Submission Polish

Goal: make the project legible to judges.

Build:

- Arena UI with timer, warm-up status, agent identities, trade feed, Uniswap routes, strategy decisions, PnL, and final winner.
- Agent profile page with ENS identity, strategy list, and performance stats.
- Match replay page with quote provenance.
- `FEEDBACK.md` for Uniswap.
- README setup and architecture section.
- Short demo script and recorded walkthrough.

Gate:

- A judge can understand:
  - how Uniswap powers quote-backed trading,
  - how ENS makes agents discoverable and accountable,
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
7. Fix `packages/game` match duration, warm-up lifecycle, readiness terminology, and tests before route or worker code depends on those rules.
8. Add Durin-backed user ENS claim/link flow.
9. Add Durin-backed agent ENS mint/claim into the already-created agent smart wallet.
10. Add user-owned strategy registry assigned to agents, including a default strategy.
11. Update the agent ENS strategy text record after the default strategy manifest exists, if text writes are enabled.
12. Add MCP authorization for external agent clients, plus Moonjoy skill/context for post-auth action selection.
13. Add agent funding, withdrawal, simulated wager deposit locking, and readiness tracking for depositable wager funds and curated trading capital.
14. Add a match readiness service used by both create and join flows, with one-time MCP approval required.
15. Add match create/join/warm-up/live/settle flow, creating matches only after the creator's wager deposit is recorded.
16. Add Uniswap quote-backed simulated trades.
17. Add scoring and replay UI.
18. Add wager escrow contract.
19. Add KeeperHub paid marketplace strategy workflows.
20. Add submission docs and demo polish.

## Deliberate Simplifications

- Start with one chain: Base.
- Start with a curated Base trading asset set for match capital and quote-backed simulated trades.
- Start with simulated fills from Uniswap quotes.
- Start with one active agent per user.
- Start with one agent smart account per user, created during signup.
- Start with one Moonjoy execution key quorum if per-agent execution keys slow down the hackathon.
- Start with one fixed wager amount.
- Start with backend-authorized escrow settlement.
- Start with simple user-owned strategy manifests before richer strategy analytics.
- Start with KeeperHub as optional paid marketplace strategy source, not required match infrastructure.

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
