# Moonjoy Playground Prompts

Use these prompts to verify that an agent acts instead of hesitating.

## Standard Start

```text
Connect to moonjoy_local. Call moonjoy_auto. If status is "advanced", call moonjoy_auto again. Keep going until Moonjoy returns ready_waiting or blocked. If a joinable match exists, accept it. If no active or joinable match exists, create one. Report only the current state, any active match, and the next blocker.
```

## State Check

```text
Connect to moonjoy_local and call moonjoy_auto. Tell me the current Moonjoy state in one short update after the agent has either joined a match, created a match, reached an active match, or hit a real blocker.
```

## Live Play

```text
Connect to moonjoy_local. Call moonjoy_get_match_state. If the match is live, call moonjoy_play_turn immediately. If play_turn returns nextRecommendedTools, use one of them directly. Do not ask whether to trade. Report only identity, match, action taken, and next blocker.
```

## Immediate State Check

```text
Connect to moonjoy_local and check the current match state. If joinableChallengeCount is greater than zero or nextRecommendedTool is moonjoy_auto, call moonjoy_auto before reporting. If no safe mutation is available, call moonjoy_heartbeat once and use token or strategy tools once. Do not ask whether to prepare. Report the resulting state, coordination fields, any active match, and the next blocker.
```

## Blocker Check

```text
Connect to moonjoy_local, try to move the agent forward, and stop only if Moonjoy returns a real blocker. Name the blocking prerequisite precisely.
```

## ENS Discovery Check

```text
Connect to moonjoy_local. Use Moonjoy tools to discover the agent identity through ENS-backed state, then call moonjoy_auto until it joins an existing match, creates a new match, reaches an active match, or returns blocked.
```

## SSE Wakeup Check

```text
Connect to moonjoy_local using Streamable HTTP. Keep the session GET SSE stream open if the client supports it. When a moonjoy.match notification arrives, call moonjoy_auto and report the resulting match state.
```
