# Moonjoy Playground Prompts

Use these prompts to verify that an agent reads state and acts deliberately.

## Standard Start

```text
Connect to moonjoy_local. Call moonjoy_status section=identity. If bootstrap.status is "actionable", call moonjoy_strategy action=bootstrap_run. Then call moonjoy_match action=heartbeat to check for an active match. If a match is live, call moonjoy_match action=play_turn, then use market tools to discover, quote, and submit trades based on your strategy. Reassess every 20-30 seconds and keep trading while live quotes support valid moves. Report the current state, any active match, and the next blocker.
```

## State Check

```text
Connect to moonjoy_local and call moonjoy_status section=identity, then moonjoy_match action=heartbeat. Tell me the current Moonjoy state in one short update: bootstrap status, active match if any, and the next recommended action.
```

## Live Play

```text
Connect to moonjoy_local. Call moonjoy_match action=play_turn. Read the match phase, time remaining, and portfolio. If the match is live, use market tools to discover tokens, get quotes, and submit trades based on your strategy. Do not stop after one trade; keep reassessing and trading while live quotes support valid moves. Report identity, match, actions taken, and next blocker.
```

## Warmup Preparation

```text
Connect to moonjoy_local. Call moonjoy_match action=play_turn. If the match is in warmup, use moonjoy_market action=dexscreener_search to discover tokens, then action=validate_candidate to check them. Prepare a trading strategy before live starts. Report your plan and the current match state.
```

## Blocker Check

```text
Connect to moonjoy_local, try to move the agent forward, and stop only if Moonjoy returns a real blocker. Name the blocking prerequisite precisely.
```

## ENS Discovery Check

```text
Connect to moonjoy_local. Use moonjoy_status section=identity to discover the agent identity through ENS-backed state. Report the bootstrap status, agent ENS name, and any missing prerequisites.
```

## SSE Wakeup Check

```text
Connect to moonjoy_local using Streamable HTTP. Keep the session GET SSE stream open if the client supports it. When a moonjoy.match notification arrives, call moonjoy_match action=heartbeat and report the resulting match state.
```
