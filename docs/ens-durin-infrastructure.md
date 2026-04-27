# Moonjoy ENS / Durin L2 Operations

Moonjoy uses Durin to issue L2 ENS subnames on Base Sepolia. The parent domain is `moonjoy.eth`. User names like `buzz.moonjoy.eth` and agent names like `agent-buzz.moonjoy.eth` are minted as ERC-721 NFTs on the L2 Registry.

Source contract: `/Users/george/Workspace/durin/src/examples/L2Registrar.sol`

## Contract Addresses (Base Sepolia, chain 84532)

| Contract | Address |
|----------|---------|
| Admin Wallet | `0x59d4C5BE20B41139494b3F1ba2A745ad9e71B00B` |
| L2 Registry (`moonjoy.eth`) | `0xe5491a3d982ef454ec99a432b213dc749b997275` |
| L2 Registrar | `0xB803EA09c7d315b6A92c2CD5E48193eCE0b25535` |

## Mint a Subname

Call `register(string label, address owner)` on the L2 Registrar.

```solidity
// L2Registrar at 0xB803EA09c7d315b6A92c2CD5E48193eCE0b25535
function register(string calldata label, address owner) external
```

Behavior:
- Mints `label.moonjoy.eth` as an ERC-721 NFT to `owner`.
- Sets the address record for Base Sepolia (coinType `2147492898`) and mainnet ETH (coinType `60`).
- Auto-sets primary name for reverse resolution if owner doesn't have one.
- Emits `NameRegistered(label, owner)`.
- Minimum label length: 3 characters.
- No access control (FIFS). No fee.

**viem example** (Base Sepolia):

```typescript
import { createWalletClient, http } from 'viem'
import { baseSepolia } from 'viem/chains'

const registrarAbi = [
  'function register(string label, address owner) external',
  'function available(string label) external view returns (bool)',
]

const walletClient = createWalletClient({
  chain: baseSepolia,
  transport: http(),
  account: agentSmartAccount,
})

// Check availability
const isAvailable = await publicClient.readContract({
  address: '0xB803EA09c7d315b6A92c2CD5E48193eCE0b25535',
  abi: registrarAbi,
  functionName: 'available',
  args: ['buzz'],
})

// Register
const hash = await walletClient.writeContract({
  address: '0xB803EA09c7d315b6A92c2CD5E48193eCE0b25535',
  abi: registrarAbi,
  functionName: 'register',
  args: ['buzz', agentSmartAccountAddress],
})
```

## Check Availability

```solidity
function available(string calldata label) external view returns (bool)
```

Returns `true` if the label is not registered AND is >= 3 characters.

## Set Text Records

Text records are set on the **L2 Registry** (not the Registrar). The caller must be the NFT owner of the name.

```solidity
// L2Registry at 0xe5491a3d982ef454ec99a432b213dc749b997275
function setText(bytes32 node, string calldata key, string calldata value) external
```

To get the `node` (bytes32 namehash), call the Registry's `namehash` or `makeNode` helper:

```solidity
function makeNode(bytes32 parentNode, string calldata label) external pure returns (bytes32)
function namehash(string calldata name) external pure returns (bytes32)
```

**viem example — set text records after registration:**

```typescript
const registryAbi = [
  'function setText(bytes32 node, string key, string value) external',
  'function makeNode(bytes32 parentNode, string label) external pure returns (bytes32)',
  'function baseNode() external view returns (bytes32)',
]

// Get the node for "buzz.moonjoy.eth"
const baseNode = await publicClient.readContract({
  address: '0xe5491a3d982ef454ec99a432b213dc749b997275',
  abi: registryAbi,
  functionName: 'baseNode',
})

const buzzNode = await publicClient.readContract({
  address: '0xe5491a3d982ef454ec99a432b213dc749b997275',
  abi: registryAbi,
  functionName: 'makeNode',
  args: [baseNode, 'buzz'],
})

// Set text records (caller must be the NFT owner of "buzz")
await walletClient.writeContract({
  address: '0xe5491a3d982ef454ec99a432b213dc749b997275',
  abi: registryAbi,
  functionName: 'setText',
  args: [buzzNode, 'moonjoy:user', 'buzz.moonjoy.eth'],
})

await walletClient.writeContract({
  address: '0xe5491a3d982ef454ec99a432b213dc749b997275',
  abi: registryAbi,
  functionName: 'setText',
  args: [buzzNode, 'moonjoy:mcp', 'https://moonjoy.app/mcp'],
})
```

## Read Text Records

```solidity
function text(bytes32 node, string key) external view returns (string)
```

```typescript
const resolverAbi = [
  'function text(bytes32 node, string key) external view returns (string)',
]

const mcpUrl = await publicClient.readContract({
  address: '0xe5491a3d982ef454ec99a432b213dc749b997275',
  abi: resolverAbi,
  functionName: 'text',
  args: [buzzNode, 'moonjoy:mcp'],
})
```

## Set Address Records

```solidity
function setAddr(bytes32 node, address addr) external
function setAddr(bytes32 node, uint256 coinType, bytes calldata a) external
```

The `register()` function already sets coinType 60 (ETH) and the L2 chain coinType. Use `setAddr` to update or add additional chain addresses.

## Planned Text Records

| Key | Example Value | Purpose |
|-----|--------------|---------|
| `avatar` | ipfs://Qm... | Agent profile image |
| `moonjoy:user` | `buzz.moonjoy.eth` | Link to human user name |
| `moonjoy:mcp` | `https://moonjoy.app/mcp` | MCP endpoint discovery |
| `moonjoy:strategy` | `Qm...CID` | Active strategy manifest hash |
| `moonjoy:last_match` | `uuid-of-match` | Latest match pointer |
| `moonjoy:stats` | `ipfs://...` | Compact stats pointer |

## Other Registry Operations

### Read address

```solidity
function addr(bytes32 node) external view returns (address)
function addr(bytes32 node, uint256 coinType) external view returns (bytes memory)
```

### Set content hash

```solidity
function setContenthash(bytes32 node, bytes calldata hash) external
```

### Primary / reverse name

The Registrar tracks a `primaryName` mapping per address:

```solidity
function getName(address addr) external view returns (string memory)
function getFullName(address addr) external view returns (string memory)
function setPrimaryName(string calldata label) external
```

`setPrimaryName` requires the caller to own the name NFT.

## Deployment Transactions (Apr-25-2026, Base Sepolia)

| Step | Tx Hash | Block | Action |
|------|---------|-------|--------|
| Deploy Registry | `0x1b2c0973...` | 40692009 | `deployRegistry("moonjoy.eth", ...)` via factory |
| Deploy Registrar | `0xad3c1bfd...` | 40692086 | Constructor with registry address |
| Authorize Registrar | `0x90613706...` | 40692147 | `addRegistrar(0xB803EA09...)` on registry |
| Test registration | `0x7a15d39d...` | 40692192 | `register("test", admin)` — confirmed working |

## Notes

- All operations are on Base Sepolia (testnet). The caller must have Base Sepolia ETH for gas.
- `setText`, `setAddr`, and `setContenthash` require the caller to be the NFT owner of the name (enforced by the L2 Registry's `Unauthorized` error).
- The Registrar is permissionless: anyone can register any available label >= 3 chars. If Moonjoy needs gated registration, either modify the Registrar contract or add backend coordination.
- Text records are not set during `register()`. They require separate `setText()` calls after the name is minted.
