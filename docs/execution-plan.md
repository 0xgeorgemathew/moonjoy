# Moon Joy Execution Plan

See `docs/planned-execution-strategy.md` for the current sequential product plan covering Privy auth, embedded signer setup, Privy smart wallet creation at user signup, Durin-backed user ENS setup before MCP authorization, mandatory one-time MCP authorization for external agent clients, post-auth agent-owned ENS identity and strategy bootstrap through Moonjoy skill/context/MCP tools, one-agent-per-user rules, user-owned strategies assigned to agents, atomic simulated wager deposit locks before match creation or joining, curated Base trading capital, warm-up, Uniswap quote-backed simulation, and KeeperHub paid marketplace strategy workflows.

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
- Keep Privy, Uniswap, and route orchestration in `apps/web` until they are truly shared.
- Create the user's single agent smart wallet during signup, before any external agent authenticates through MCP.
- Set up user ENS through the deployed Durin registry and registrar before MCP authorization.
- Treat onchain state as canonical wherever it exists: Durin for ENS names, address resolution, and text records; token contracts for balances; escrow contracts for deposits and settlement.
- Use Supabase for app workflow state, MCP approvals, offchain simulation data, quote snapshots, and replay records. Do not use Supabase as the canonical source for ENS, balances, ownership, escrow status, or transaction success.
- Treat MCP authorization as external-agent approval only, not wallet provisioning.
- After MCP authorization, let the approved agent mint or claim its derived ENS identity and create or select its default strategy through Moonjoy tools.
- Treat one-time MCP approval as mandatory before match creation or joining.
- Treat agent funding as a match readiness requirement, not an MCP authorization requirement.
- Use public `moonjoy:match_preference` records for future automatch defaults: duration, bet amount, and trading capital.
- Let direct challenge links carry explicit settings for a specific opponent.
- Record the creator's simulated $10 wager deposit atomically before creating a match, and record the opponent's simulated deposit atomically before accepting the opponent seat.
- Keep wager deposit handling behind an adapter so escrow can replace the simulated ledger later.
- Once escrow exists, deposit readiness must be read from the contract, with DB rows used only for match linkage and receipt hashes.
- Check curated Base trading assets for trading capital readiness.
- Let approved agents use Moonjoy skill files, `.md` context, and MCP tools to decide post-auth actions such as agent identity setup, strategy updates, strategy decision recording, or simulated trades.

## Phase 3: Background Worker

- Add `apps/worker` when match timers, quote refresh, cleanup, and settlement need to run outside request handlers.
- Import pure rules from `packages/game`.
- Add `packages/db` only when database helpers are shared by both web and worker.

## Phase 4: Contracts

- Initialize `foundry` as a normal Foundry project at the repository root.
- Add `packages/contracts` after ABIs and deployment addresses need to be consumed by TypeScript.
- Sync generated contract metadata from Foundry outputs into `packages/contracts`.

## Phase 5: Hardening

- Add package tests around game rules and shared database mapping.
- Add worker tests around state transitions and cleanup jobs.
- Keep package boundaries based on runtime needs, not on premature categorization.
