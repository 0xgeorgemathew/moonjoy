# Moonjoy Playground Agent Instructions

This folder is for launching agents that should operate through `moonjoy_local` with minimal friction.

## Primary Rule

Act deliberately. Use ENS-discovered Moonjoy identity, read match state, and make your own trading decisions based on strategy and market data. Humans create and accept match invites through the web app — the agent never creates, discovers, accepts, or cancels invites.

## Required Launch Sequence

1. Connect to `moonjoy_local`.
2. Call `moonjoy_status section=identity` to read bootstrap state.
3. If `bootstrap.status` is "actionable", call `moonjoy_strategy action=bootstrap_run` explicitly to complete setup.
4. Call `moonjoy_match action=heartbeat` to reconcile match state.
5. If the match is live, call `moonjoy_match action=play_turn` to check phase, time, and portfolio.
6. Use market tools to discover tokens, get quotes, and submit trades when the agent decides to.
7. During live play, reassess every 20-30 seconds and keep trading when a valid next move exists.
8. Report only the resulting state, active match if any, and the next real blocker.

## Tool Policy

- `moonjoy_match action=heartbeat` is the primary state polling tool. It reads match state and returns status. Call it periodically to stay current.
- `moonjoy_match action=play_turn` reads live match state, portfolio, and phase. It returns recommendations but does not auto-trade — the agent decides when to trade.
- `moonjoy_market action=dexscreener_search` discovers tokens. `action=validate_candidate` checks if a token is tradable. `action=quote` previews a trade. `action=submit_trade` executes a simulated trade.
- The opening and closing windows are minimum participation checks, not a one-trade target. If a quote-backed move is still valid, keep trading.
- `moonjoy_strategy action=bootstrap_run` completes setup steps (agent identity, default strategy). The agent calls it explicitly when bootstrap.status is "actionable".
- `moonjoy_status section=portfolio` reads balances and PnL. `section=leaderboard` shows match rankings.
- Use `moonjoy_strategy action=record_decision` to record strategy rationale during and after matches.

## Stop Conditions

Stop and ask the user only when:

- a tool call fails
- a genuinely ambiguous irreversible action remains
- bootstrap status is "blocked" with no clear resolution

Do not ask "should I trade", "should I prep", or "should I hold". Read state, form a judgment, and act through the appropriate tool.

## Initial Prompt

Use this as the starting prompt for a fresh agent session:

```text
Connect to moonjoy_local. Call moonjoy_status section=identity to read bootstrap state. If bootstrap.status is "actionable", call moonjoy_strategy action=bootstrap_run. Then call moonjoy_match action=heartbeat to check for an active match. If a match is live, call moonjoy_match action=play_turn, then use market tools to discover, quote, and submit trades based on your strategy. Reassess every 20-30 seconds and keep trading while live quotes support valid moves. Report the current state, any active match, and the next blocker.
```

## Reference Files

- `./agent-context.md`
- `./test-prompts.md`

Use them for operating behavior, not for product explanation.
