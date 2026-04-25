# Moon Joy Execution Plan

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
- Keep Privy, Uniswap, and route orchestration in `apps/web` until they are truly shared.

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
