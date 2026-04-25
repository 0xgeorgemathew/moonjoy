# Moonjoy

**PvP agent trading with real identity, real wallets, and quote-backed market simulation.**

Moonjoy is a hackathon project for ETHGlobal Open Agents. Players create a Moonjoy agent, fund its Privy smart wallet, and enter short wagered trading matches where autonomous agents compete on normalized PnL. The first demo keeps execution safe and fast: agents trade through deterministic simulated fills backed by live Uniswap quotes on Base, while identities and match history are tied to ENS names.

```txt
Human user -> Privy signup -> Agent smart wallet -> ENS agent identity
Approved agent -> Moonjoy MCP/tools/context -> Strategies -> Quote-backed trades
Match replay -> Uniswap routes + strategy provenance + normalized PnL winner
```

## Why It Matters

Autonomous agents need more than chat. They need wallets, identities, rules, provenance, and a reason to compete. Moonjoy turns those pieces into a visible game loop:

- users own agents and strategies,
- agents operate from their own smart wallets,
- ENS names make agents discoverable and accountable,
- Uniswap quotes make simulated trades market-aware,
- match replays show why an agent acted,
- normalized PnL makes matches fair across different capital sizes.

## Demo Use Cases

- **Agent-vs-agent trading battles**: two players fund agents and compete in a five-minute Base market challenge.
- **Agent identity and reputation**: each agent resolves from an ENS name such as `agent-buzz.moonjoy.eth` to its Privy smart wallet.
- **Strategy attribution**: user-owned strategies are assigned to agents and linked to decisions in the match replay.
- **Quote-backed trade simulation**: agents request live Uniswap quotes and Moonjoy records route, routing type, token pair, amounts, gas estimate, and timestamp.
- **Wagered PvP loop**: the first demo uses a fixed $10 wager separated from trading capital, with escrow planned after the offchain game loop is stable.
- **Agent playground testing**: Codex, Claude, opencode, and other agents can be tested against shared Moonjoy context in `playground/`.

## Partner Tracks

### Uniswap

Uniswap is the trading layer. Moonjoy uses live quotes on Base to power deterministic simulated fills before real swap execution is enabled.

Built for the demo:

- Base-only quote-backed simulated trades.
- Curated token list for reliable liquidity and judging.
- Stored quote metadata for every fill.
- Replay UI that exposes route, routing type, amounts, gas estimate, and timestamp.
- `FEEDBACK.md` before submission.

### ENS + Durin

ENS is the identity layer. Moonjoy uses names for product behavior, not decoration.

Built for the demo:

- Human names like `buzz.moonjoy.eth`.
- Agent names like `agent-buzz.moonjoy.eth`.
- Agent names resolve to the agent smart wallet address.
- Text records can point to MCP endpoint, strategy provenance, latest match, and public stats.
- Durin is used where it accelerates L2 subnames and mintable agent identities.

Registrar work is valuable polish, but it does not block the core match loop.

### Privy

Privy is the auth and smart wallet layer.

Core distinction:

- The user signs up through Privy.
- Moonjoy creates one agent smart wallet during signup.
- MCP authorization later approves an external agent client.
- MCP auth does not create the wallet, mint ENS, or create strategies by itself.
- After auth, the agent uses Moonjoy context, skill files, and MCP tools to decide next actions.

The agent smart wallet owns victories, stats, wager actions, trading actions, and public agent identity. Strategies are user-owned and attributed to the agent when used.

### KeeperHub

KeeperHub is a stretch strategy marketplace layer.

Planned stretch:

- Publish private workflows as paid marketplace strategies.
- Let other agents discover and pay to run those strategies.
- Keep workflow steps private from buyers.
- Store listing id, workflow id, execution id, price, output, and decision linkage.
- Show paid strategy usage in the replay.

## Match Flow

1. User signs in with Privy.
2. Moonjoy creates the user's single agent record and agent smart wallet.
3. User claims or links a Moonjoy ENS name.
4. User approves an external agent through Moonjoy MCP.
5. The approved agent reads Moonjoy context and chooses the next allowed action.
6. Both players join a fixed-term match.
7. Warm-up starts so agents can inspect state and prepare.
8. Live trading starts for five minutes.
9. Agents submit Uniswap quote-backed simulated trades.
10. Moonjoy snapshots portfolios, calculates normalized PnL, and selects the winner.
11. Replay shows identities, wallets, strategies, quotes, fills, and final scoring.

## Architecture

```txt
apps/web
  Next.js app, Privy flows, UI, API routes, MCP endpoint, service adapters

apps/worker
  Future timers, quote polling, cleanup, settlement retries

packages/game
  Pure TypeScript match rules, readiness, scoring, PnL, winner selection

supabase
  User, agent, strategy, match, trade, quote, and audit tables

contracts
  Future wager escrow and settlement contracts
```

`packages/game` stays runtime-agnostic. It must not import Next.js, Privy, Supabase, Uniswap, ENS, KeeperHub, environment variables, or filesystem APIs.

## Repository

```txt
apps/web              Next.js game UI and service boundary
apps/worker           Background runtime scaffold
packages/game         Pure game rules
docs/                 Architecture and execution strategy
playground/           Agent test prompts and shared context
supabase/migrations   Database migrations
```

## Local Development

This repo uses Bun workspaces and Turbo.

```bash
bun install
bun run lint
bun run typecheck
bun run test
bun run build
```

Do not start the dev server unless you are actively working on local UI behavior; the project instructions assume it is already running.

## Current Build Priority

1. Five-minute match constants, warm-up state, and normalized-PnL scoring.
2. Privy signup with automatic agent smart wallet creation.
3. ENS user identity and explicit post-auth agent ENS mint/claim.
4. Moonjoy MCP authorization and agent operating context.
5. Agent funding/readiness and user-owned strategy registry.
6. Match create/join/warm-up/live/settle loop.
7. Uniswap quote-backed simulated trades.
8. Replay UI with quote provenance and strategy attribution.
9. Minimal wager escrow.
10. KeeperHub paid marketplace strategies.

## Status

Moonjoy is intentionally optimized for hackathon speed. The goal is a judge-legible vertical slice that proves agents can own wallets, carry ENS identities, make attributable market decisions, and compete in a replayable PvP trading game.
