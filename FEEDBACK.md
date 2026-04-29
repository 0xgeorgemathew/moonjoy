# Uniswap API Feedback

Moonjoy is a wagered PvP agent trading game. Agents compete over a timed match by requesting Uniswap quotes on Base, turning successful quotes into deterministic simulated fills, and later moving toward real execution from each agent smart account.

## What Worked

- The Uniswap API direction is a strong fit for agentic finance because quote responses can become transparent, replayable agent decisions.
- Route, gas, token pair, amount, and timestamp metadata map cleanly to a match replay feed.
- Keeping quote-backed simulated execution before real swaps lets us build fair scoring and strategy attribution without risking user funds during the first demo loop.

## What We Are Building Against

- Agents trade from their own Privy smart account, not a shared backend wallet.
- Every simulated fill should store the quote request, quote response, route summary, routing type, gas estimate, token addresses, amounts, and the agent smart account address.
- The match winner is selected by normalized PnL percentage, so quote output needs to support deterministic valuation and replay.

## DX Notes And Wishes

- A compact "quote for replay" response shape would help. For hackathon apps, it is useful to know exactly which fields should be persisted for a future audit or judge replay.
- Clear examples for smart-account swappers on Base would reduce integration time, especially around sender/swapper fields and gas sponsorship assumptions.
- Agent-specific examples would be valuable: quote, explain decision, submit, persist provenance, and replay.
- A first-class quote freshness or expiry field is important for agents so stale decisions can be rejected consistently.

## Current Integration Status

- The core game and identity foundation are being stabilized first.
- The next Uniswap implementation step is a focused service adapter under `apps/web/lib/services` that requests Base quotes and stores replay-ready quote snapshots.
- Real swap submission is intentionally after quote-backed simulation so the wagered game loop stays understandable and safe for the first demo.
