# ENS Agent UX Improvement Report

Date: 2026-05-01

## Executive Summary

Moonjoy already has a meaningful ENS foundation. The project is not treating ENS as cosmetic: user identities are intended to be Durin-backed subnames, agent identities are derived from user names, agent names resolve to smart accounts, and match readiness checks already depend on onchain identity.

The biggest opportunity is to make ENS the public, machine-readable agent infrastructure layer rather than only a registration gate. The current plan and code are close, but several high-value pieces are incomplete:

1. ENS-scoped invite validation currently appears broken because the invite service tries to resolve an ENS name through a function that expects a Moonjoy user id.
2. Agent ENS text records are not yet publishing the full discovery and provenance surface described in the product plan.
3. Strategy provenance is locally modeled, but the public `moonjoy:strategy` verification path is not implemented yet.
4. ENSIP-25 and ERC-8004 are not reflected in the current product plan or implementation, even though they now directly match the hackathon correspondence around verifiable AI agent identity.
5. The app lacks a first-class public agent profile or metadata document that can be discovered from ENS and reused by wallets, agents, explorers, or judges.

The recommended direction is to keep the current Durin architecture, fix the scoped invite resolution bug, then add a compact agent profile and text-record bundle:

```txt
moonjoy:type=agent
moonjoy:user=buzz.moonjoy.eth
moonjoy:mcp=https://moonjoy.up.railway.app/mcp
moonjoy:profile=https://moonjoy.up.railway.app/agents/agent-buzz.moonjoy.eth.json
moonjoy:strategy=sha256:<active-strategy-manifest-hash>
moonjoy:last_match=<latest-public-match-id>
moonjoy:stats=https://moonjoy.up.railway.app/agents/agent-buzz.moonjoy.eth/stats.json
agent-registration[<erc7930-registry-address>][<agent-id>]=1
```

This gives Moonjoy a concrete ENS story: names are the access layer, smart accounts are the game wallets, text records are the discovery layer, and strategy plus match history become portable public reputation.

## External Research

### ENS L2 Subnames And Durin

ENS docs describe L2 subnames as a way for developers to connect an L1 ENS name with smart contracts on an L2, reducing subname issuance cost while keeping ENS resolution semantics. The docs specifically position Durin as an opinionated L2 subname framework that handles the L1 resolver and CCIP Read gateway pieces so apps can focus on L2 registrar business logic.

Durin's own guide describes the L2 registry as the contract that tracks ownership of ENS subdomains as ERC-721 NFTs and stores text records, coin types, and contenthash for subdomains. That directly supports Moonjoy's current direction: user and agent names can be real onchain identities on Base Sepolia rather than offchain labels.

Source references:
- https://docs.ens.domains/web/subdomains/
- https://docs.ens.domains/learn/ccip-read/
- https://durin.dev/

### ENS Text Records As Agent Metadata

ENS text records are standardized key-value records for arbitrary public metadata. ENS docs list common standardized records such as `avatar`, `description`, `url`, `com.twitter`, `com.github`, and `header`, and recommend prefixing custom keys with an app or protocol namespace to avoid collisions. Moonjoy's `moonjoy:*` keys follow that recommendation.

For Moonjoy, text records should be treated as public machine-readable claims, not just profile decoration:

- `moonjoy:mcp` tells other agents where to connect.
- `moonjoy:strategy` tells observers which public strategy manifest was active.
- `moonjoy:last_match` and `moonjoy:stats` let an agent's reputation follow the ENS name.
- `moonjoy:user` links the agent name back to the human ENS name.
- Standard `avatar`, `description`, and `url` can make the profile legible in ENS-aware wallets and explorers.

Source reference:
- https://docs.ens.domains/web/records/

### ENS Primary Names And Reverse Verification

ENSjs exposes `getName` for primary-name lookup. The returned shape includes a `match` field, which matters because an app should not display a reverse name as verified identity unless the reverse record and forward resolution agree.

Moonjoy has a custom Durin registrar reverse lookup path with `getUserName(address)` and `getAgentName(address)`. That is acceptable for the current Durin setup, but the same principle applies: display names and access decisions should verify both directions whenever possible:

1. address -> expected name through registrar reverse lookup,
2. expected name -> address through the registry address record,
3. ownerOf/name ownership when ownership matters.

Source reference:
- Context7 ENSjs docs for `/ensdomains/ensjs`, `getName` and `getRecords`.

### ENSIP-25 For Verifiable AI Agent Identity

ENSIP-25 is directly relevant to the correspondence. It defines a parameterized ENS text record key:

```txt
agent-registration[<registry>][<agentId>]
```

The value should be a non-empty string, commonly `"1"`. The purpose is to verify that an ENS name is associated with an AI agent identity in an onchain registry such as ERC-8004. The verification flow starts from the registry entry, constructs the text-record key, resolves that key on the claimed ENS name, and fails if the value is missing or empty.

This is a strong match for Moonjoy because the product already has:

- agent ENS names,
- agent smart accounts,
- public strategy identity,
- match history,
- a clear need for other agents and frontends to verify the agent they are dealing with.

Important caveat: ENSIP-25 is currently draft. It should be implemented as additive metadata, not as the only readiness gate for the first demo unless the team also completes the matching registry path.

Source references:
- https://docs.ens.domains/ensip/25/
- https://ens.domains/blog/post/ensip-25

### ERC-8004 For Agent Identity, Discovery, Reputation, And Validation

ERC-8004 is a draft Ethereum standard for trustless agents. It defines three registry concepts:

- Identity Registry: ERC-721 based agent identity with an `agentURI`.
- Reputation Registry: feedback signals.
- Validation Registry: independent validation checks.

The identity registry's registration file can advertise services including MCP endpoints, A2A cards, ENS names, DIDs, wallet endpoints, and other capability surfaces. That maps well to Moonjoy's external-agent model.

Moonjoy should not let ERC-8004 distract from the game loop, but it should prepare an ERC-8004-compatible agent registration file now. If there is time, register a demo agent and publish the ENSIP-25 text record on the agent ENS name. If not, still expose the profile and leave the ERC-8004 registry fields empty or marked pending.

Source reference:
- https://eips.ethereum.org/EIPS/eip-8004

### ERC-7828, `on.eth`, And Chain-Specific Names

ERC-7828 is a review-stage standard for interoperable names in the form:

```txt
<address>@<chain>#<checksum>
```

When the address side is an ENS name, examples include:

```txt
alice.eth@ethereum
wallet.ensdao.eth@eip155:1
```

The standard lets chain labels such as `base` resolve through the `on.eth` namespace, while ENS names remain the human-readable address component. This matters for Moonjoy because the game is Base-oriented, and agent wallets can become clearer if the UI and records use chain-specific display strings such as:

```txt
agent-buzz.moonjoy.eth@base
```

This should be treated as future-facing UX. The current app can start by storing and displaying explicit chain context near every ENS-resolved address, then later adopt ERC-7828 parsing and formatting once support is practical.

Source reference:
- https://eips.ethereum.org/EIPS/eip-7828

## Current Moonjoy State

### What Is Already Strong

The product plan already says ENS is core identity infrastructure. `docs/planned-execution-strategy.md` requires Durin-backed user and agent subnames, agent names resolving to agent-controlled addresses, and text records for user linkage, strategy provenance, and public match history.

Current implementation already includes:

- Durin contract addresses and ABIs in `packages/contracts/src/durin/*`.
- `apps/web/lib/services/ens-service.ts` for Durin reads and writes.
- User ENS availability and claim routes.
- Transaction confirmation that checks receipt success, target contract, calldata, sender, bootstrap wallet, and resulting address resolution.
- Agent bootstrap through the approved MCP context.
- Match and invite gates that require user ENS and agent ENS before play.
- A short-lived ENS read cache that explicitly does not replace chain as source of truth.

This is already aligned with the ENS feedback: users and agents are not raw addresses in the product model.

### Gaps Against The Current Plan

The implementation is behind the plan in a few important places:

- `buildExpectedAgentTextRecords` currently returns only `moonjoy:type` and `moonjoy:user`; it does not include `moonjoy:mcp`, `moonjoy:strategy`, `moonjoy:last_match`, or `moonjoy:stats`.
- `strategyPointerMatches` is currently always `true`, so readiness cannot yet prove that the ENS `moonjoy:strategy` record matches the active local strategy.
- Scoped invite validation intends to resolve an ENS name at join time, but the current helper passes the ENS name into `resolveUser`, which expects a user id.
- The plan mentions MCP discovery records, but no current text-record key publishes the MCP endpoint.
- Public match history pointers are planned but not updated after match settlement.
- ENSIP-25 and ERC-8004 are missing from the current docs, even though the ENS correspondence makes them a high-signal hackathon improvement.

## Priority Recommendations

### P0: Fix ENS-Scoped Invite Resolution

Current issue:

`apps/web/lib/services/invite-service.ts` has `resolveUserByName(ensName)`, but it calls `resolveUser(ensName)`. `resolveUser` loads a Supabase user row by `id`, so an ENS name such as `buzz.moonjoy.eth` will not resolve correctly through that path.

Impact:

- ENS-scoped invite creation can reject valid ENS names.
- ENS-scoped invite joining can reject the intended holder.
- The product claim "ENS-scoped invites resolve through Durin at join time" is not currently reliable.

Recommended fix:

- Add an explicit ENS-name resolver helper, for example `resolveMoonjoyName(ensName)`.
- Normalize and validate that the name is under `.moonjoy.eth`.
- Extract the label with `extractEnsLabel`.
- Resolve the address using Durin `resolveAddress(label)`.
- Optionally verify `getFullNameForAddress(address)` returns the same normalized name.
- Use this helper in both invite creation and join.
- Add tests for valid scoped invite, wrong user, unresolved name, uppercase input normalization, and non-Moonjoy ENS rejection.

This is the highest-value fix because it repairs a promised ENS product feature and makes the demo safer.

### P1: Publish A Complete Agent ENS Discovery Record Set

Current issue:

The plan targets multiple records, but the implementation only syncs:

```txt
moonjoy:type
moonjoy:user
```

Recommended minimum record set for the demo:

```txt
moonjoy:type=agent
moonjoy:user=buzz.moonjoy.eth
moonjoy:mcp=https://moonjoy.up.railway.app/mcp
moonjoy:profile=https://moonjoy.up.railway.app/agents/agent-buzz.moonjoy.eth.json
moonjoy:strategy=sha256:<active-strategy-manifest-hash>
```

Recommended after-match records:

```txt
moonjoy:last_match=<match-id-or-url>
moonjoy:stats=<stats-json-url-or-cid>
```

Implementation notes:

- Extend `buildExpectedAgentTextRecords` to accept the active strategy pointer and app origin.
- Avoid making `moonjoy:last_match` required for initial readiness.
- Keep `moonjoy:mcp` and `moonjoy:profile` stable.
- Sync `moonjoy:strategy` whenever an active strategy is created or changed.
- Change `strategyPointerMatches` from hard-coded `true` to an actual comparison.

This turns ENS into discovery infrastructure and gives judges something visible to inspect onchain.

### P1: Add A Public Agent Profile Document

ERC-8004's registration file shape is a useful template even if Moonjoy does not fully deploy ERC-8004 during the demo.

Recommended endpoint:

```txt
GET /agents/[agentEnsName].json
```

Recommended shape:

```json
{
  "type": "https://moonjoy.app/agent-profile-v1",
  "name": "agent-buzz.moonjoy.eth",
  "description": "Moonjoy trading agent for buzz.moonjoy.eth",
  "image": "https://moonjoy.up.railway.app/agents/agent-buzz.moonjoy.eth/avatar.png",
  "ensName": "agent-buzz.moonjoy.eth",
  "userEnsName": "buzz.moonjoy.eth",
  "chain": "eip155:84532",
  "smartAccountAddress": "0x...",
  "services": [
    {
      "name": "MCP",
      "endpoint": "https://moonjoy.up.railway.app/mcp",
      "version": "2025-06-18"
    },
    {
      "name": "ENS",
      "endpoint": "agent-buzz.moonjoy.eth",
      "version": "v1"
    }
  ],
  "strategy": {
    "pointer": "sha256:...",
    "sourceType": "default_behavior"
  },
  "registrations": [],
  "active": true
}
```

This endpoint should be generated from verified onchain ENS state plus local app workflow state. It should not present Supabase as canonical for ENS ownership or address resolution.

### P1: Add ENSIP-25 Compatibility

Recommended path:

1. Add docs and constants for the ENSIP-25 key format:

```txt
agent-registration[<registry>][<agentId>]
```

2. If an ERC-8004 registry entry exists, let the agent publish:

```txt
agent-registration[<erc7930-registry-address>][<agent-id>]=1
```

3. Show verification status in the agent profile:

```txt
ensip25: pending | verified | missing_registry_claim | missing_ens_attestation
```

4. Do not block first-demo match readiness on ENSIP-25 unless registry registration is fully implemented.

This is a compact, high-signal improvement because it directly answers the ENS team's agent identity direction without replacing the current Durin design.

### P1: Use ENS As The Public Replay And Reputation Index

Current plan already targets `moonjoy:last_match` and `moonjoy:stats`, but no current code writes them.

Recommended after settlement:

- Write a durable public match summary JSON.
- Store the hash, CID, or URL in `moonjoy:last_match`.
- Store compact aggregate stats pointer in `moonjoy:stats`.
- Include winner, normalized PnL, strategy pointer, quote snapshots, and simulated trade ids.

This makes Moonjoy's "public reputation layer" claim much stronger. The app can still store full replay data in Supabase, but the public pointer should live in ENS.

### P2: Add Standard ENS Profile Records

Moonjoy-specific records are good for machines, but standardized records are better for ecosystem display.

Recommended user records:

```txt
avatar
description
url
```

Recommended agent records:

```txt
avatar
description
url
```

Example agent description:

```txt
Autonomous Moonjoy trading agent for buzz.moonjoy.eth. Trades quote-backed simulated Base markets from its smart account.
```

This is not as critical as the verification and discovery records, but it improves ENS wallet/explorer UX.

### P2: Add Chain-Specific Display Strings

Because Moonjoy is Base-oriented, display identity should make chain context explicit:

```txt
agent-buzz.moonjoy.eth
Base Sepolia smart account: 0x...
Future display: agent-buzz.moonjoy.eth@base
```

Do not overbuild ERC-7828 support for the hackathon. The useful improvement is to avoid ambiguous address presentation and prepare copy/types for future `name@chain` UX.

### P2: Consolidate Match Readiness Into One Service

The plan already asks for one readiness service. Today, readiness checks are split across invite, match, funding, MCP, and bootstrap services.

Recommended output shape:

```ts
type MatchReadiness = {
  ready: boolean;
  userEns: Requirement;
  agentEns: Requirement;
  mcpApproval: Requirement;
  executionAuthority: Requirement;
  strategy: Requirement;
  strategyEnsPointer: Requirement;
  wagerFunds: Requirement;
  tradingCapital: Requirement;
};
```

ENS-specific requirements should report exact resolved values:

- expected user ENS,
- resolved user address,
- embedded signer address,
- expected agent ENS,
- resolved agent address,
- agent smart account address,
- required text-record mismatches.

This will improve UX and reduce duplicated gate logic.

## Suggested Execution Order

1. Fix ENS-scoped invite resolution and add tests.
2. Extend agent text record syncing for `moonjoy:mcp`, `moonjoy:profile`, and `moonjoy:strategy`.
3. Make `strategyPointerMatches` a real comparison and surface mismatches in bootstrap/readiness.
4. Add a public agent profile JSON endpoint.
5. Add ENSIP-25 constants and optional attestation support.
6. Write `moonjoy:last_match` and `moonjoy:stats` after settlement or demo auto-settle.
7. Add standard profile records (`avatar`, `description`, `url`) when the core flow is stable.
8. Add chain-specific `name@chain` display support as a UI polish pass.

## Cross-Reference Matrix

| Area | External best practice | Current Moonjoy state | Gap | Priority |
| --- | --- | --- | --- | --- |
| L2 subnames | Durin-backed L2 subnames with onchain registry ownership | Durin registry and registrar configured | Good foundation | Done |
| User ENS | Human-readable user identity resolves onchain | User claim flow and confirmation route exist | Needs stronger profile records | P2 |
| Agent ENS | Agent name resolves to smart account | Agent bootstrap exists | Text-record bundle incomplete | P1 |
| ENS-scoped invites | Resolve name at join time, fail closed | Intended in docs and service | Helper resolves by user id instead of ENS name | P0 |
| MCP discovery | Agent metadata should advertise service endpoint | MCP endpoint exists | Not published in ENS records | P1 |
| Strategy provenance | Public pointer should match active strategy | Strategy DB records exist | `strategyPointerMatches` hard-coded true; no `moonjoy:strategy` sync | P1 |
| Public history | Reputation should follow agent identity | Planned in docs | No `moonjoy:last_match` or `moonjoy:stats` writer | P1 |
| ENSIP-25 | ENS name attests to agent registry entry | Not present | Add optional text-record verification path | P1 |
| ERC-8004 | Agent registration file advertises services/capabilities | Not present | Add compatible profile JSON, optional registry registration | P1/P2 |
| Cross-chain UX | Chain-specific names reduce ambiguity | Base Sepolia hard-coded | Add chain context and future `name@chain` display | P2 |

## Bottom Line

Moonjoy's ENS direction is already credible. The meaningful improvement is not "add ENS" but "make ENS the public control plane":

- invitations use ENS for access,
- agents use ENS for identity,
- MCP endpoints are discoverable through ENS,
- strategies are attributable through ENS,
- match history and stats are portable through ENS,
- ENSIP-25 links Moonjoy agent names to broader onchain agent registries.

The highest ROI work is fixing scoped invite resolution and completing the agent text-record/profile layer. That combination turns the ENS integration from a good onboarding feature into real agent UX infrastructure.
