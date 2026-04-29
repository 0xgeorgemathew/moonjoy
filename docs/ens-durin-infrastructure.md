# Moonjoy ENS / Durin L2 Operations

Moonjoy uses Durin on Base Sepolia for two ENS identities:

- `buzz.moonjoy.eth` for the human user EOA
- `agent-buzz.moonjoy.eth` for the agent smart wallet

The human name is still human-owned. The agent name is smart-wallet-owned.

## Live Base Sepolia Contracts

| Contract | Address |
|----------|---------|
| Admin Wallet | `0x59d4C5BE20B41139494b3F1ba2A745ad9e71B00B` |
| L2 Registry | `0xe0AAd73E595D37Ccacf182CC821dB7D158bf040b` |
| Moonjoy L2 Registrar | `0x9d3EBCE7eDF58Ca5329b21B96085097405B3916B` |

## Registrar Model

`registerUser(string label, string matchPreference, address agentBootstrapWallet)`

- caller is the human EOA
- mints `label.moonjoy.eth` to the human EOA
- writes:
  - `addr`
  - `moonjoy:type=user`
  - optional `moonjoy:match_preference`
- stores `agentBootstrapWallet` as the smart wallet authorized to self-register the derived agent name later

`registerAgent(string userLabel, address agentSmartWallet)`

- can be called either by:
  - the human ENS owner, or
  - the pre-authorized `agentBootstrapWallet` when `msg.sender == agentSmartWallet`
- mints `agent-{userLabel}.moonjoy.eth` directly to the smart wallet
- writes:
  - `addr`
  - `moonjoy:type=agent`
  - `moonjoy:user=<human ENS name>`

`setAgentBootstrapWallet(string label, address agentSmartWallet)`

- caller is the human EOA owner of `label.moonjoy.eth`
- updates the smart wallet allowed to self-register the derived agent name

## Match Preference Shape

`moonjoy:match_preference` is compact JSON:

```json
{
  "duration": "any",
  "wagerUsd": "10",
  "capitalUsd": {
    "min": "any",
    "max": "250"
  }
}
```

- `duration` supports `"any"` or explicit seconds like `"300"` / `"600"`
- `capitalUsd.min` and `capitalUsd.max` support `"any"` or explicit USD values

## Moonjoy Runtime Expectations

- human-name registration is an EOA transaction
- agent-name registration is an agent smart-wallet transaction once the human claim stored the bootstrap wallet
- agent-owned ENS text writes should execute from the smart wallet
- all Privy transaction paths should request sponsorship with `sponsor: true`

## Reverse Lookups

The registrar exposes verified reverse lookups:

- `getUserName(address)`
- `getAgentName(address)`

These mappings are checked against current registry ownership on read, so stale transfer state returns an empty string instead of false identity.
