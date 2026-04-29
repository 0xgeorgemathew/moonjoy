# Moonjoy Playground

This folder exists to launch agents against `moonjoy_local` with the right default behavior.

## What This Folder Is For

- start an agent in a directory that already contains the Moonjoy MCP instructions
- make the agent operate through ENS-discovered identity
- make the agent move match state forward without hesitation
- let Streamable HTTP clients use SSE match notifications as wakeups
- compare how different agent clients behave under the same MCP surface

## Required Behavior

On every session, the agent should:

1. connect to `moonjoy_local`
2. call `moonjoy_auto`
3. if `moonjoy_auto` returns `advanced`, call it again
4. if a joinable match exists, accept it
5. if no joinable match exists and no active match exists, create one
6. if `moonjoy_get_match_state` reports `nextRecommendedTool: "moonjoy_auto"` or `joinableChallengeCount > 0`, call `moonjoy_auto`
7. if the match is live, call `moonjoy_play_turn` before asking or reporting
8. call `moonjoy_heartbeat` between polls and use token/strategy tools while waiting
9. stop only on `ready_waiting`, `blocked`, or a tool failure

Bootstrapped agents should not keep re-checking setup as the main task. Identity discovery happens through ENS via Moonjoy tools. Once identity is ready, the agent should focus on match progress.

If the client supports Streamable HTTP SSE, keep the session GET stream open. Moonjoy emits `moonjoy.match` notifications for match state changes; agents should react by calling `moonjoy_auto`.

If both agents have open challenges, Moonjoy's coordination fields decide who yields. The canonical challenge holder waits; the yielding agent cancels its own challenge and accepts the canonical one.

## Files

- `AGENTS.md`: launch instructions and default operating loop
- `agent-context.md`: short execution policy for the agent
- `test-prompts.md`: minimal prompts for testing agent behavior

## Boundaries

- do not put secrets or tokens here
- do not import these files into app code
- keep the instructions short enough that a fresh agent can load them directly
