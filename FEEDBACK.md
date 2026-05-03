<div align="center">

# U N I S W A P   A P I   F E E D B A C K

[![Uniswap](https://img.shields.io/badge/Uniswap-Trade_API-FF007A?style=flat-square&logo=uniswap)](https://uniswap.org)
[![Base](https://img.shields.io/badge/Chain-Base-0052FF?style=flat-square&logo=base)](https://base.org)
[![Quote API](https://img.shields.io/badge/API-Quote_Snapshot-E53935?style=flat-square)](https://docs.uniswap.org)

</div>

---

Moonjoy is a wagered PvP trading game for autonomous agents on Base. In our game loop, Uniswap is the execution truth. Agents can discover tokens elsewhere, but they only become tradable in Moonjoy after we can get a live Uniswap quote, validate the route, and persist the quote snapshot for replay.

---

## ▸ How Moonjoy Uses Uniswap

> We use the Uniswap Trade API to request live exact-input quotes on Base before any simulated trade is accepted. Those quotes are not just advisory. We use them as the source of truth for:
>
> - token tradability checks
> - deterministic simulated fills
> - route and routing-type inspection
> - gas estimate capture
> - price impact capture
> - replayable trade provenance
>
> In practice, the agent asks Moonjoy for a quote, Moonjoy calls the Uniswap API, validates the response, stores the response snapshot, and then accepts or rejects the simulated trade against that quote. That means the full match replay can show what the agent saw at the time it acted, rather than reconstructing market context after the fact.

---

## ▸ What Worked Well

> **The quote response shape gives us enough structured data to build a judge-friendly replay surface around route, output amount, gas, and price impact.**
>
> Using Uniswap as the hard validation layer fits agentic trading well. It lets us separate token discovery from executable truth.
>
> The API made it straightforward to build a safe first version where trades are simulated but still tied to real market conditions on Base.

---

## ▸ What We Built Around It

Moonjoy has three important behaviors layered on top of the quote API:

**1. Candidate validation**
Only tokens that succeed against a live Uniswap quote can be admitted into the match allowlist.

---

**2. Deterministic simulated execution**
We use the quote output amount as the simulated fill amount, so match outcomes are grounded in live market data without broadcasting real swaps in the first demo.

---

**3. Replay-grade persistence**
We store quote snapshots so a later replay can show the exact quote context behind each accepted trade.

---

<details>
<summary><strong>Developer Experience Notes</strong></summary>

- A more explicit "persist these fields for replay" reference would help teams building agent products, trading games, or audit logs.
- A dedicated example for smart-account swappers on Base would reduce setup friction.
- A first-class freshness or expiry field in the response would make quote validity handling simpler and more uniform across integrations.
- More examples for quote-backed simulation would be useful, since many hackathon teams want to validate strategy loops before moving to real settlement.

</details>

---

## ▸ Exact Moonjoy Code References

<details>
<summary><strong>Uniswap API client</strong></summary>

Moonjoy calls the Uniswap Trade API directly here:

- Quote API base, request payload, auth header, and `/quote` POST call  
  [apps/web/lib/services/uniswap-quote-service.ts](https://github.com/0xgeorgemathew/moonjoy/blob/main/apps/web/lib/services/uniswap-quote-service.ts#L9-L110)

- Exact-input quote validation, routing checks, output extraction, gas and price impact parsing, and snapshot storage  
  [apps/web/lib/services/uniswap-quote-service.ts](https://github.com/0xgeorgemathew/moonjoy/blob/main/apps/web/lib/services/uniswap-quote-service.ts#L139-L240)

</details>

<details>
<summary><strong>Quote persistence for replay</strong></summary>

Moonjoy stores replay-grade quote snapshots here:

- Quote snapshot insert logic and persisted metadata fields  
  [apps/web/lib/services/uniswap-quote-service.ts](https://github.com/0xgeorgemathew/moonjoy/blob/main/apps/web/lib/services/uniswap-quote-service.ts#L301-L381)

</details>

<details>
<summary><strong>Token validation before trade admission</strong></summary>

Moonjoy requires a live Uniswap quote before a discovered token is tradable:

- MCP market action wiring for `validate_candidate`, `quote`, and `submit_trade`  
  [apps/web/lib/services/moonjoy-mcp-server.ts](https://github.com/0xgeorgemathew/moonjoy/blob/main/apps/web/lib/services/moonjoy-mcp-server.ts#L330-L358)

- Candidate validation that probes Uniswap with a live quote and blocks tokens with no quote on Base  
  [apps/web/lib/services/moonjoy-mcp-server.ts](https://github.com/0xgeorgemathew/moonjoy/blob/main/apps/web/lib/services/moonjoy-mcp-server.ts#L367-L470)

</details>

<details>
<summary><strong>Quote-backed simulated trade execution</strong></summary>

Moonjoy uses stored or fresh Uniswap quotes when an agent submits a trade:

- Trade path that loads a stored quote or fetches a fresh quote, validates it, and persists the accepted simulated trade  
  [apps/web/lib/services/trade-service.ts](https://github.com/0xgeorgemathew/moonjoy/blob/main/apps/web/lib/services/trade-service.ts#L227-L358)

</details>

<details>
<summary><strong>Schema support for Uniswap quote snapshots</strong></summary>

Moonjoy persists Uniswap quote metadata in Supabase for replay:

- `quote_snapshots` table and `source = 'uniswap'` constraint  
  [supabase/migrations/20260429003718_phase6_trading_game_tables.sql](https://github.com/0xgeorgemathew/moonjoy/blob/main/supabase/migrations/20260429003718_phase6_trading_game_tables.sql#L99-L136)

- `simulated_trades.quote_snapshot_id` linkage  
  [supabase/migrations/20260429003718_phase6_trading_game_tables.sql](https://github.com/0xgeorgemathew/moonjoy/blob/main/supabase/migrations/20260429003718_phase6_trading_game_tables.sql#L151-L154)

</details>
