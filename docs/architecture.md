# Moon Joy Architecture

Moon Joy is organized as a small Bun monorepo optimized for fast hackathon iteration.

## Workspace Boundaries

```txt
apps/web
  Next.js app, browser UI, API routes, Privy flows, MCP HTTP endpoint, and web-owned services.

apps/worker
  Future background runtime for timers, polling, cleanup, execution monitoring, and settlement.

packages/game
  Pure TypeScript game rules shared by web, worker, tests, and future contract-facing code.

packages/db
  Future shared Supabase types and thin database helpers once web and worker both need them.

packages/contracts
  Future TypeScript contract ABIs, addresses, and chain metadata generated from Foundry outputs.

foundry
  Future Solidity workspace. Keep it as a normal Foundry project at the repository root.

supabase
  Root database migrations and seed data.
```

## Dependency Direction

Application workspaces may import shared packages:

```txt
apps/web -> packages/game
apps/worker -> packages/game
apps/web -> packages/db, packages/contracts when those packages exist
apps/worker -> packages/db, packages/contracts when those packages exist
```

Shared packages must not import from `apps/*`.

`packages/game` must stay runtime-agnostic: no Next.js, Supabase, Privy, Uniswap, environment variables, or filesystem access.

## Current Slice

The initial restructure intentionally keeps the repo small:

- `apps/home` was renamed to `apps/web`.
- `packages/game` now owns pure match/scoring helpers.
- Supabase migrations live at the repository root.
- Foundry is not scaffolded yet so `forge init foundry` can run cleanly later.
