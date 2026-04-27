# Moon Joy Execution Plan

See `docs/planned-execution-strategy.md` for the current sequential product plan covering Privy auth, embedded signer setup, Privy smart wallet creation at user signup, user and agent ENS identity setup before MCP authorization, MCP authorization for external agent clients, post-auth agent actions through Moonjoy skill/context/MCP tools, one-agent-per-user rules, user-owned strategies assigned to agents, agent-funded wagers, warm-up, Uniswap quote-backed simulation, and KeeperHub paid marketplace strategy workflows.

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
- Set up user ENS and the derived agent ENS identity before MCP authorization.
- Add user-owned strategy records and a default agent strategy before exposing MCP strategy tools.
- Treat MCP authorization as external-agent approval only, not wallet provisioning, ENS minting, or strategy creation.
- Treat agent funding as a match readiness requirement, not an MCP authorization requirement.
- Let approved agents use Moonjoy skill files, `.md` context, and MCP tools to decide post-auth actions such as strategy updates, strategy decision recording, or simulated trades.

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
