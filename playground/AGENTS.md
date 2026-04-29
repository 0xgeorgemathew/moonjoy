# Moonjoy Playground Agent Instructions

This folder is for launching agents that should operate through `moonjoy_local` with minimal friction.

## Primary Rule

Be forward-moving. Use ENS-discovered Moonjoy identity, then either join an available match or create one. Do not ask the user for permission when Moonjoy tools expose an actionable next step.

## Required Launch Sequence

1. Connect to `moonjoy_local`.
2. Call `moonjoy_auto`.
3. If the response has `status: advanced`, call `moonjoy_auto` again.
4. If polling with `moonjoy_get_match_state` shows `nextRecommendedTool: "moonjoy_auto"` or `joinableChallengeCount > 0`, call `moonjoy_auto`.
5. If the match is live, call `moonjoy_play_turn` before asking or reporting.
6. If waiting with no safe mutation, call `moonjoy_heartbeat` between polls and use token/strategy tools to keep preparing. Do not ask the user whether to prepare.
6. Report only the resulting state, active match if any, and the next real blocker.

## Tool Policy

- `moonjoy_auto` is the primary driver. It reads ENS-backed identity, finishes bootstrap only when needed, analyzes open challenges, accepts a joinable match, or creates a new match.
- Use `moonjoy_play_turn` first in live matches. It can auto-trade and returns follow-up tools when no immediate auto-trade is available.
- Use `moonjoy_get_match_state` to poll while a match is active, then call `moonjoy_auto` if the state has joinable challenges or recommends `moonjoy_auto`.
- Use `moonjoy_heartbeat` between polls. It can join or play when safe, but will not create a new challenge.
- Use `moonjoy_discover_base_tokens`, `moonjoy_get_token_risk_profile`, `moonjoy_get_market_quote`, and strategy tools while waiting so the agent keeps preparing.
- Use `moonjoy_list_open_challenges`, `moonjoy_create_challenge`, and `moonjoy_accept_challenge` only when you need precise control or `moonjoy_auto` is unavailable.
- Use `moonjoy_get_identity` / `moonjoy_get_bootstrap_action` for diagnostics.
- Lower-level bootstrap tools (`moonjoy_run_bootstrap`, `moonjoy_claim_agent_identity`, `moonjoy_execute_bootstrap_step`) are available but rarely needed.

## Stop Conditions

Stop and ask the user only when:

- `moonjoy_auto` returns `blocked`
- a tool call fails
- a genuinely ambiguous irreversible action remains

Do not ask "should I trade", "should I prep", or "should I hold". Use play-turn, safe read-only tools, and heartbeat directly.

If two agents both have open challenges, use Moonjoy's coordination fields. The canonical challenge holder waits; the yielding agent cancels its own challenge and accepts the canonical one. Do not manually cancel both challenges.

## Initial Prompt

Use this as the starting prompt for a fresh agent session:

```text
Connect to moonjoy_local. Call moonjoy_auto. If status is "advanced", call moonjoy_auto again. Keep going until status is "ready_waiting" or "blocked". If there is a joinable match, accept it. If there is no active or joinable match, create one. Report the current state, any active match, and the next blocker. Do not ask for confirmation before moonjoy_auto runs bootstrap or match actions.
```

## Reference Files

- `./agent-context.md`
- `./test-prompts.md`

Use them for operating behavior, not for product explanation.
