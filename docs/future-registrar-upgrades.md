# Moonjoy L2Registrar Upgrade Plan

Source contract: `/Users/george/Workspace/durin/src/examples/L2Registrar.sol`
Target: `MoonjoyL2Registrar.sol` — a new registrar deployed to Base Sepolia

These upgrades target two ETHGlobal ENS prize tracks:

- **Best ENS Integration for AI Agents** — resolving agent address, gating access, enabling discovery, agent-to-agent interaction
- **Most Creative Use of ENS** — beyond name→address, subnames as access tokens, verifiable on-chain agent identity

---

## Tier 1: Core (build with the new registrar)

### A. Agent Derivation + Paired Registration

The current registrar has no concept of user vs agent. Anyone can register any label. Nothing connects `buzz` to `agent-buzz`.

**New functions:**

```solidity
function registerUser(string calldata label, address userSigner) external
function registerAgent(string calldata userLabel, address agentSmartAccount) external
```

Rules:
- `registerAgent` derives the agent label as `agent-{userLabel}` — not arbitrary
- Caller must own the user name NFT (ENS is the access gate)
- Agent name NFT is minted to the agent smart account, not the user
- Sets `moonjoy:type` = `agent`, `moonjoy:user` = `{label}.moonjoy.eth` on the agent node

Prize relevance: "resolving agent address", "gating access", one-agent-per-user enforced on-chain.

### B. Batch Records on Mint

The L2Registry `createSubnode` accepts `bytes[] data` for multicall. Current registrar passes `new bytes[](0)`.

New functions accept initial text records:

```solidity
function registerUser(
    string calldata label,
    address owner,
    string[] calldata keys,
    string[] calldata values
) external
```

Sets address records + all text records in one tx. Demo feels instant.

### C. Agent Discovery Resolver

Read-only view that returns everything about an agent from ENS:

```solidity
struct AgentProfile {
    address agentAddress;
    address userAddress;
    string userEnsName;
    string mcpEndpoint;
    string currentStrategy;
}

function resolveAgent(string calldata userLabel) external view returns (AgentProfile memory)
```

Prize relevance: "agent-to-agent interaction", "enabling discovery". Opponent lookup = ENS resolution.

### D. Match Access Gate

Read-only view that checks if an agent is fully provisioned for match play:

```solidity
function isAgentReady(string calldata userLabel) external view returns (bool)
```

Checks: user name exists, agent name exists, agent addr resolves, MCP endpoint is set.

Prize relevance: "gating access" — ENS is the gatekeeper, not the database.

---

## Tier 2: Post-Match (add after the base game loop works)

### E. Verifiable Match History in Text Records

After each match, store a verifiable result pointer in the agent's ENS records:

```solidity
function recordMatchResult(
    string calldata userLabel,
    string calldata matchId,
    string calldata resultIpfsCid,
    string calldata statsJson
) external
```

Updates `moonjoy:last_match`, `moonjoy:last_result`, `moonjoy:stats` on the agent node.

Prize relevance: "Most Creative" — agent reputation is stored in ENS, not a centralized database. An AI agent's competitive record travels with its ENS identity across any frontend.

---

## Tier 3: Stretch (only if time allows)

### F. Subnames as Match Access Tokens

For each match, mint `match-{id}.agent-buzz.moonjoy.eth` as an ERC-721 NFT. Ownership = match access. Burn after the match = revocation.

```solidity
function mintMatchAccess(
    string calldata userLabel,
    string calldata matchLabel,
    address participant
) external onlyNameOwner(userLabel) returns (bytes32)
```

Prize relevance: "subnames as access tokens" is literally in the "Most Creative" judging criteria. Strongest creative play but requires deeper subname tree management.

---

## Implementation Notes

- Deploy as a new contract (`MoonjoyL2Registrar.sol`), do not modify the existing Durin example in-place.
- The new contract needs `addRegistrar()` called on the existing L2 Registry (`0xe5491a3d...`) after deployment.
- All view functions (C, D) are gas-free and can be called by any contract or offchain indexer.
- Tier 1 = one deployment, one `addRegistrar()` tx, all core game flows covered.
- Text record keys follow the plan in `planned-execution-strategy.md`: `moonjoy:type`, `moonjoy:user`, `moonjoy:mcp`, `moonjoy:strategy`, `moonjoy:last_match`, `moonjoy:stats`.
