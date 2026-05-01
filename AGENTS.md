# Moonjoy Agent Instructions

## Project Context

Moonjoy is a hackathon project for ETHGlobal Open Agents. It should be built with hackathon-level speed, but code should still follow the Three Laws of Software Design:

- Correctness over style.
- Clarity over cleverness.
- Restraint over premature abstraction.

This is a Bun monorepo. Use Bun commands and workspace conventions unless a tool explicitly requires otherwise.

## Source Of Truth

- Architecture boundaries: `docs/architecture.md`
- Detailed sequential plan: `docs/planned-execution-strategy.md`
- Short execution overview: `docs/execution-plan.md`
- Visual design system: `DESIGN.md`

When these files conflict, prefer the more specific and more recent document. For current product behavior, `docs/planned-execution-strategy.md` is the primary source of truth.

## Dev Server

Do not run the dev server. Always assume it is already running.

## Core Product Rules

Moonjoy is a wagered PvP agent trading game.

- The default match duration is 5 minutes.
- Every match has a warm-up stage before live trading starts.
- The first demo wager is $10.
- The wager is separate from each user's trading capital.
- Users fund the agent smart account, and the agent deploys trading capital from that account.
- Onchain state is canonical wherever it exists. Resolve ENS names, ENS records, balances, ownership, escrow deposits, escrow settlement, and transaction status from chain.
- Do not duplicate onchain state in Supabase as canonical product state. Supabase may store app workflow state, offchain simulation data, replay snapshots, and receipt hashes only after verification.
- Highest normalized PnL wins.
- The winner should be selected by PnL percentage from each player's starting marked portfolio value, not raw dollar PnL.
- Real swap execution is out of scope for the first demo.
- Live Uniswap quote data and deterministic simulated execution are in scope.
- The wager should move toward an escrow contract after the offchain game loop is stable.

### Humans Decide Who Plays. Agents Decide How To Trade.

- Humans create and accept match invites through the web app.
- Invite types: open (any eligible authenticated human can join) or ens (only the holder/resolved controller of a specific ENS name can join).
- Invite terms live server-side. The shareable link carries an opaque invite token, not trusted state.
- Match starts only after both humans have joined. Agent autonomy starts after the human creates or joins a match.
- Agents must never create challenges, browse open challenges, accept opponents, or decide matchmaking.
- The agent's job is: inspect assigned match, inspect allowed capital, discover market opportunities, prepare strategy, mark ready during warm-up, submit quote-backed simulated trades during live play, record rationale.
- Dexscreener is the agent's market radar. Uniswap is the execution truth.
- For ENS-scoped invites, resolve through Durin at join time. Do not trust query params, cached ENS values, Supabase ENS mirrors, or client-submitted wallet addresses.

## User, Agent, And Strategy Model

- A player is a user plus that user's Moonjoy agent.
- A user always has exactly one active agent.
- The human user creates setup intent and game intent.
- The agent smart account is the player wallet.
- The agent smart account makes the wager and performs trades.
- The human user can fund, withdraw from, recover, or pause the agent smart account.
- There is no agent selection during match setup.
- There is no manual strategy selection during match setup.
- An agent may own and use one or more strategies.
- Strategy choice is autonomous agent behavior and must be attributable after the match.
- Strategies can come from user chat, `.md` context, agent-generated plans, default behavior, or KeeperHub workflows.

## Identity And Auth

- Use Privy for authentication and wallet creation or linking.
- Authenticated users claim or link a Moonjoy ENS name, such as `buzz.moonjoy.eth`.
- Resolve user ENS identity from Durin by embedded signer address instead of saving the confirmed name in the database.
- The user's single agent gets a Privy smart wallet / smart account.
- After Moonjoy MCP authorization, the approved agent can mint or claim an ENS identity, such as `agent-buzz.moonjoy.eth`.
- The agent ENS name must be derived from the human user's claimed ENS label.
- `agent-buzz.moonjoy.eth` resolves to the agent smart account address.
- Agent ENS records must do real product work: address resolution, ownership, MCP endpoint discovery, strategy provenance, and public match history pointers.
- Resolve agent ENS identity and text records from Durin when gating match readiness or displaying public identity.
- Match creation requires an authenticated user, a user ENS identity, an approved live agent identity, and a funded agent smart account. Humans create invites through the web app; agents never create, discover, accept, or cancel invites.
- The agent smart account is created during user signup before MCP authorization.
- Agent authorization happens through Moonjoy MCP auth after the user has an agent smart account and user ENS identity. MCP approval lets an external client operate through Moonjoy tools; it does not provision wallets.
- Agent ENS minting or claiming is an explicit post-MCP agent action, not a hidden authorization side effect.
- The human user creates the match intent. The agent account follows match rules, makes the wager, and trades.

## Partner Track Priorities

### Uniswap

Uniswap is the primary trading partner track.

- Use Uniswap API quotes on Base for simulated trades.
- Use the agent smart account address as the Uniswap swapper address once real execution is enabled.
- Store quote request and response metadata for every simulated fill.
- Show route, routing type, token pair, amounts, gas estimate, and timestamp in the UI.
- Dexscreener is the agent's market radar for token discovery. Uniswap is the execution truth for trade validation.
- Agents discover tokens through Dexscreener MCP tools. Moonjoy validates only trade eligibility through Uniswap quotes.
- Return risk warnings on Dexscreener candidates rather than silently filtering. Only no Uniswap quote or not Base should block trade admission.
- Add `FEEDBACK.md` at the repo root before submission.

### ENS

ENS is the primary identity partner track.

- ENS must not be cosmetic.
- Use ENS to resolve users and agents, discover agent metadata, and attribute strategy and match history.
- The agent ENS name should resolve to the agent smart account address that wagers and trades.
- Use Durin if time allows for stronger L2 subname and registrar functionality.
- If Durin setup blocks progress, keep the MVP on functional ENS resolution and text records.

### KeeperHub

KeeperHub is a stretch strategy workflow track.

- Use KeeperHub after the base game works.
- Publish strategy workflows such as Recovery Strategy, Go for Victory, Crash Landing Strategy, Discover Tokens, and Rebalance to Base.
- KeeperHub strategies sit alongside an agent's default strategy.
- The match must still work if KeeperHub is disabled.

## Workspace Boundaries

```txt
apps/web
  Next.js app, UI, API routes, Privy flows, MCP endpoint, and service adapters.

apps/worker
  Background runtime for timers, warm-up expiry, quote polling, autonomous agent loop coordination, cleanup, and settlement retries.

packages/game
  Pure TypeScript game rules, match lifecycle helpers, scoring, and winner selection.
```

`packages/game` must stay runtime-agnostic. Do not import Next.js, Supabase, Privy, Uniswap, ENS, KeeperHub, environment variables, or filesystem APIs into it.

Shared packages must not import from `apps/*`.

## Next.js Guidance

- Prefer Server Components by default.
- Use Client Components only for state, effects, wallet/auth UI, or browser APIs.
- Keep pages and route handlers thin.
- Put backend logic in focused services under `apps/web/lib/services`.
- Explicitly handle loading, empty, and error states.
- Avoid unnecessary `useEffect`.

## TypeScript Guidance

- Use strict typing.
- Use explicit types at module boundaries.
- Use inference for obvious local variables.
- Avoid `any`.
- Use `unknown` when narrowing is required.
- Keep unions and domain types readable.
- Do not use complex generics or type-level programming for runtime behavior.

## Rules For Adding Files

1. New component: `apps/web/components/<feature>-<name>.tsx`
2. New page or route: standard App Router path under `apps/web/app`
3. New API route: `apps/web/app/api/<resource>/route.ts` or `apps/web/app/api/<resource>/<id>/route.ts`
4. New service: `apps/web/lib/services/<name>-service.ts`
5. New hook: `apps/web/lib/hooks/use-<name>.ts`
6. New type: add to the appropriate file in `apps/web/lib/types/`, or create a focused new domain type file
7. New migration: `supabase/migrations/<timestamp>_<name>.sql`
8. New pure game rule: add it to `packages/game/src`

Use kebab-case for new file names. Import files directly. Do not add barrel files unless the package already exposes one and the change is coordinated.

## Design Direction

Follow `DESIGN.md` and the existing UI before introducing new visual patterns.

Moonjoy should feel lunar, competitive, tactical, and agentic. The current direction is a high-contrast space/brutalist interface with strong typography and explicit trading data. Keep UI dense enough for repeated gameplay, not a generic landing-page experience.

## Implementation Priorities

Build in this order unless the user explicitly redirects:

1. Privy auth, embedded signer creation, one-agent-per-user record, and agent smart wallet creation during signup.
2. User ENS claim or link flow and safe public user text records.
3. MCP authorization for external agent clients and Moonjoy skill/context setup.
4. Agent-owned ENS identity and default strategy bootstrap through approved Moonjoy tools.
5. Agent funding display, withdrawal entry points, and match readiness checks that read current chain balances for wager funds and trading capital.
6. Match constants, invite status rules, and warm-up lifecycle in `packages/game`.
7. Human invite creation (open and ENS-scoped), invite join flow, warm-up, live, settle flow.
8. Dexscreener market discovery MCP tools and Uniswap quote-backed simulated trades.
9. Portfolio scoring and match replay.
10. Wager escrow contract funded by agent smart accounts.
11. KeeperHub strategy workflows.
12. Submission docs and demo polish.

## Testing And Verification

- Add or update tests for non-trivial game rules.
- Keep pure rule tests in `packages/game`.
- Run the narrowest useful check after changes.
- For docs-only changes, tests are not required.
- Do not start the dev server for verification.

## Git Workflow

- Pull frequently when collaborating.
- Keep commits small and focused.
- Use commit messages like `feat(arena): add warm-up state` or `fix(wallet): handle missing agent funding`.
- Do not revert unrelated worktree changes.
- If a conflict touches a shared file and the right resolution is unclear, ask before choosing.


<claude-mem-context>
# Memory Context

# [moonjoy] recent context, 2026-05-01 7:23am GMT+5:30

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (28,401t read) | 0t work

### Apr 25, 2026
1967 8:06p 🔴 Match action rules fixed — "ready" status now exposes start_match, settlement grace boundary guard added
1968 " ✅ Railway deployment configuration added — RAILPACK builder with bunx next start, turbo.json persistent start task
1973 " ✅ Moon Joy main branch fully synchronized with origin — clean working tree, 4 commits pushed
1974 11:22p ⚖️ Moon Joy hackathon architecture — full system design with partner track integration
1977 11:23p 🔵 Moon Joy tech stack research — MCP SDK, ENSjs, viem, Uniswap API, and Privy capabilities confirmed
1978 11:55p ⚖️ Moon Joy PvP trading game — full execution strategy with phases, strategy tracks, and auth flow
1980 11:56p 🔵 Moon Joy monorepo full inventory — current state before execution strategy document
1982 11:59p 🟣 Moon Joy planned execution strategy — 12-phase sequential plan written to docs/planned-execution-strategy.md
### Apr 26, 2026
1983 12:32a 🔵 AGENTS.md update initiated — gathering context from existing docs
1986 " ✅ AGENTS.md fully rewritten with comprehensive project instructions
1987 12:34a ✅ AGENTS.md rewrite confirmed — diff verified, file on disk matches intent
1989 12:37a ✅ AGENTS.md update completed — full rewrite applied and verified
1991 " 🔵 Privy agentic wallet architecture researched — two control models identified for Moonjoy agent trading
1993 12:38a 🔵 Privy dual-approval model identified — 2-of-2 quorum for user+server co-signing on wallets
1997 12:45a 🔵 Privy wallet creation and signer attachment API mechanics documented for Moonjoy integration
1998 1:00a ✅ Moon Joy execution docs updated with Privy agentic wallet architecture
2000 1:01a 🔵 Moon Joy full planned execution strategy document read for Privy upgrade
2001 1:03a ✅ Moon Joy execution strategy fully upgraded with Privy two-wallet model and agent trading authorization
2004 1:06a ✅ Moon Joy execution docs upgraded — Privy two-wallet model, Phase 4 trading auth, renumbered phases 0–13
2006 1:09a 🔵 Privy documentation mapped for Moon Joy's two-wallet and agent trading architecture
2008 1:15a 🔵 Privy docs fully mapped for Moon Joy's agentic wallet architecture — key pages identified
2010 1:17a ⚖️ Moon Joy architecture pivoted from two-wallet delegation model to single agent smart account model
2011 1:33a 🔵 Moon Joy hackathon execution strategy under research review
2013 1:34a 🔵 Moon Joy full execution strategy loaded — 13 phases with Privy research underway
2015 " 🔵 Context7 library resolution complete — Uniswap SDK v3 and ENSjs selected
2018 1:36a 🔵 Context7 MCP SDK library resolution timed out at 120 seconds
2019 1:38a 🔵 Context7 Privy library resolution also timed out at 120 seconds
2020 1:40a 🔵 Context7 query-docs for Uniswap API timed out — third consecutive failure
2023 1:42a 🔵 Context7 fully down — fourth consecutive timeout on ENSjs query
2024 1:44a 🔵 Privy docs and game source code fully audited — plan alignment verified with gaps found
2027 1:55a ⚖️ Moon Joy hackathon scope decisions: Privy wallet, MCP-only, KeeperHub as stretch
2028 2:02a 🔵 Moon Joy full execution strategy document reviewed — all 13 phases and data models
2031 2:03a ⚖️ Moon Joy execution strategy rewritten: smart wallet at signup, user-owned strategies, MCP-only
2035 2:05a ✅ Moon Joy execution strategy finalized — second patch pass completes doc sync across both strategy files
2038 2:11a ⚖️ Phase 3 redefined: MCP auth is approval-only, agent decides actions via skill files and context
2041 2:14a ✅ Moon Joy execution strategy finalized: phases renumbered, playground created, settlement decoupled from escrow
2042 4:40a 🟣 Moon Joy README.md creation with use cases and partner tracks
2043 4:41a 🔵 Moon Joy repository state confirmed — no root README.md exists
2045 " ✅ Moon Joy README.md created with full project narrative, use cases, and partner tracks
2047 " ✅ Moon Joy README.md committed and pushed to GitHub
2048 4:42a ✅ Moon Joy README.md push to GitHub completed successfully
2049 4:43a ✅ Moon Joy README.md rewritten with sharper, judge-optimized narrative
2051 " ✅ Moon Joy README.md v2 committed and pushed — 60% size reduction
2052 " ✅ Moon Joy README.md v2 push completed — repository synced
2053 4:44a ✅ Moon Joy README beautification with frontend design skills
2054 4:46a ✅ Moonjoy README pushed to remote
2055 4:49a 🔵 ASCII art visual shared for Moon Joy project
2056 4:50a 🔵 Moon Joy README confirmed — 103 lines with centered HTML layout
### Apr 28, 2026
2057 12:00a 🔵 Documentation Review Found Ordering Inconsistencies Across Planning Docs
2058 12:03a ✅ Execution Plan Reordering: Privy Wallet as Foundation Dependency
</claude-mem-context>
