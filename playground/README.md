# Moonjoy Agent Playground

This folder is for testing Codex, Claude, opencode, and other coding agents against the same Moonjoy context without touching production app code.

Use it to compare:

- how each agent reads Moonjoy product rules,
- how each agent chooses next actions after MCP authorization,
- how each agent proposes strategies,
- how each agent explains match state, ENS identity, wallet ownership, and Uniswap quote-backed trades.

## Boundaries

- Playground files are test inputs and scratch prompts.
- Do not import playground files from `apps/*` or `packages/*`.
- Do not store secrets, API keys, private wallet keys, or live auth tokens here.
- Keep examples small enough that agents can load them directly.

## Suggested Tests

1. Ask the agent to explain the Moonjoy wallet model.
2. Ask the agent what it should do after MCP authorization.
3. Ask the agent to create a strategy for a five-minute match.
4. Ask the agent to decide whether to mint the agent ENS name, create a strategy, request a Uniswap quote, or wait.
5. Ask the agent to summarize a simulated match replay and identify the winning agent by normalized PnL.

Start with [agent-context.md](./agent-context.md), then add tool outputs or match state snapshots as separate files when testing.
