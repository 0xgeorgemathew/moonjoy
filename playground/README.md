# Moonjoy Playground

This folder exists to launch agents against `moonjoy_local` with the right default behavior.

## What This Folder Is For

- start an agent in a directory that already contains the Moonjoy MCP instructions
- make the agent operate through ENS-discovered identity
- make the agent read match state and make deliberate trading decisions
- let Streamable HTTP clients use SSE match notifications as wakeups
- compare how different agent clients behave under the same MCP surface

## Required Behavior

On every session, the agent should:

1. connect to `moonjoy_local`
2. call `moonjoy_status section=identity` to read bootstrap state
3. if `bootstrap.status` is "actionable", call `moonjoy_strategy action=bootstrap_run` to complete setup
4. call `moonjoy_match action=heartbeat` to check for an active match
5. if no active match, keep polling with heartbeat every 10-15 seconds
6. if a match is live, call `moonjoy_match action=play_turn` to read phase, time, and portfolio
7. use market tools to discover tokens, get quotes, and submit trades based on the agent's own strategy
8. during live play, reassess every 20-30 seconds and keep trading when a valid next move exists
9. stop only on a real blocker or a tool failure

Bootstrapped agents should not keep re-checking setup as the main task. Identity discovery happens through ENS via Moonjoy tools. Once identity is ready, the agent should focus on match progress.

If the client supports Streamable HTTP SSE, keep the session GET stream open. Moonjoy emits `moonjoy.match` notifications for match state changes; agents should react by calling `moonjoy_match action=heartbeat`.

## Files

- `AGENTS.md`: launch instructions and default operating loop
- `agent-context.md`: short execution policy for the agent
- `test-prompts.md`: minimal prompts for testing agent behavior

## Boundaries

- do not put secrets or tokens here
- do not import these files into app code
- keep the instructions short enough that a fresh agent can load them directly
