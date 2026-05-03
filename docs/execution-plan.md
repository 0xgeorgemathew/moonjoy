# Moon Joy Execution Plan

See `docs/planned-execution-strategy.md` for the current sequential product plan covering Privy auth, embedded signer setup, Privy smart wallet creation at user signup, Durin-backed user ENS setup before MCP authorization, mandatory one-time MCP authorization for external agent clients, post-auth agent-owned ENS identity and strategy bootstrap through Moonjoy skill/context/MCP tools, one-agent-per-user rules, user-owned strategies assigned to agents, human invite link creation and joining (not agent matchmaking), open and ENS-scoped invites with opaque tokens, atomic simulated wager deposit locks before invite creation or joining, per-match simulated USDC trading capital, Dexscreener market discovery, warm-up, Uniswap quote-backed simulation, and KeeperHub paid marketplace strategy workflows.

## Phase 1: Monorepo Foundation

- Keep Bun workspaces at the repository root.
- Keep Turbo as the shared task runner.
- Use `apps/web` for the Next.js app.
- Use `packages/game` for pure shared game logic.
- Keep Supabase migrations in root `supabase/migrations`.

## Phase 2: Product Runtime

- Add a custom server in `apps/web/server.mts` when MCP or realtime requires it.
- Mount the Moon Joy MCP endpoint at `/mcp`.
- Keep MCP handlers as typed adapters over backend services.
- Keep MCP as the agent integration surface. Do not add a REST mirror unless MCP blocks the demo.
- Keep Privy, Uniswap, Dexscreener, and route orchestration in `apps/web` until they are truly shared.
- Create the user's single agent smart wallet during signup, before any external agent authenticates through MCP.
- Set up user ENS through the deployed Durin registry and registrar before MCP authorization.
- Treat onchain state as canonical wherever it exists: Durin for ENS names, address resolution, and text records; token contracts for balances; escrow contracts for deposits and settlement.
- Use Supabase for app workflow state, MCP approvals, invite state, offchain simulation data, quote snapshots, and replay records. Do not use Supabase as the canonical source for ENS, balances, ownership, escrow status, or transaction success.
- Treat MCP authorization as external-agent approval only, not wallet provisioning. MCP enables agent execution inside a human-approved match, not matchmaking authority.
- After MCP authorization, let the approved agent mint or claim its derived ENS identity and create or select its default strategy through Moonjoy tools.
- Treat one-time MCP approval as mandatory before match invite creation or joining.
- Treat agent funding as a match readiness requirement, not an MCP authorization requirement.
- Humans create match invites through the web app. Agents never create, discover, accept, or cancel invites.
- Invite types: open (any eligible authenticated human) or ens (scoped to a specific ENS name).
- Invite terms live server-side. The shareable link carries an opaque invite token, not trusted state.
- Record the creator's simulated $10 wager deposit atomically before creating the invite, and record the joiner's simulated deposit atomically before accepting the invite.
- For ENS-scoped invites, resolve the scoped ENS through Durin at join time. Do not trust query params, cached ENS values, Supabase ENS mirrors, or client-submitted wallet addresses.
- Keep wager deposit handling behind an adapter so escrow can replace the simulated ledger later.
- Once escrow exists, deposit readiness must be read from the contract, with DB rows used only for match linkage and receipt hashes.
- Initialize each match with fresh simulated USDC trading capital; do not depend on residual wallet tokens.
- Let approved agents use Moonjoy skill files, `.md` context, and MCP tools to decide post-auth execution actions such as agent identity setup, strategy updates, strategy decision recording, market discovery, or simulated trades.
- Dexscreener is the agent's market radar. Uniswap is the execution truth.
- Agents discover tokens through Dexscreener MCP tools. Moonjoy validates only trade eligibility through Uniswap quotes.
- Return risk warnings on Dexscreener candidates rather than silently filtering. Only no Uniswap quote or not Base should block trade admission.

## Phase 3: Background Worker

- Add `apps/worker` when invite expiry, match timers, quote refresh, cleanup, and settlement need to run outside request handlers.
- Import pure rules from `packages/game`.
- Add `packages/db` only when database helpers are shared by both web and worker.

## Phase 4: Contracts

- Initialize `foundry` as a normal Foundry project at the repository root.
- Add `packages/contracts` after ABIs and deployment addresses need to be consumed by TypeScript.
- Sync generated contract metadata from Foundry outputs into `packages/contracts`.

## Phase 5: Hardening

- Add package tests around game rules, invite status transitions, and shared database mapping.
- Add worker tests around state transitions and cleanup jobs.
- Keep package boundaries based on runtime needs, not on premature categorization.
