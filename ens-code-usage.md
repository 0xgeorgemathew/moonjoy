<div align="center">

# E N S   C O D E   U S A G E

[![ENS](https://img.shields.io/badge/ENS-Agent_Identity-5298FF?style=flat-square&logo=ethereum)](https://ens.domains)
[![Base](https://img.shields.io/badge/Chain-Base_Sepolia-0052FF?style=flat-square&logo=base)](https://base.org)
[![Durin](https://img.shields.io/badge/Durin-L2_Registrar-1565C0?style=flat-square&logo=ethereum)](https://github.com/0xgeorgemathew/durin)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.x-363636?style=flat-square&logo=solidity)](https://soliditylang.org)

</div>

---

This document is the detailed ENS prize support file for Moonjoy. It covers both:

- Moonjoy application-side ENS usage in this repository
- Moonjoy-specific registrar logic in the Durin repository at `https://github.com/0xgeorgemathew/durin`

Moonjoy uses ENS as functional product infrastructure, not display-only identity. Human players claim `label.moonjoy.eth`, agents derive `agent-label.moonjoy.eth`, and the product reads onchain ENS state for identity resolution, readiness gating, strategy provenance, and public match attribution.

---

## ▸ Prize Narrative

> Moonjoy uses ENS for four concrete product jobs:
>
> 1. **Human identity**
> Users claim a Moonjoy ENS name and the app checks availability and ownership onchain.
>
> 2. **Agent identity**
> Each user has a derived agent ENS name that resolves to the agent smart wallet.
>
> 3. **Public records**
> Moonjoy uses ENS text records such as `moonjoy:strategy`, `moonjoy:match_preference`, `moonjoy:last_match`, and `moonjoy:stats` to expose portable public metadata.
>
> 4. **Match and strategy attribution**
> Moonjoy resolves ENS records to discover public strategies and to connect the human identity to the agent identity.

---

## ▸ Moonjoy Repo References

<details>
<summary><strong>ENS service layer</strong></summary>

This is the main application ENS adapter. It resolves names, addresses, text records, and ownership against Durin contracts on Base Sepolia.

- ENS public client setup and cached reads  
  [apps/web/lib/services/ens-service.ts](https://github.com/0xgeorgemathew/moonjoy/blob/main/apps/web/lib/services/ens-service.ts#L23-L88)

- Onchain availability check and user name registration call shape  
  [apps/web/lib/services/ens-service.ts](https://github.com/0xgeorgemathew/moonjoy/blob/main/apps/web/lib/services/ens-service.ts#L89-L118)

- Address resolution and text record reads  
  [apps/web/lib/services/ens-service.ts](https://github.com/0xgeorgemathew/moonjoy/blob/main/apps/web/lib/services/ens-service.ts#L120-L173)

- Reverse resolution for human and agent names  
  [apps/web/lib/services/ens-service.ts](https://github.com/0xgeorgemathew/moonjoy/blob/main/apps/web/lib/services/ens-service.ts#L175-L224)

- Onchain owner lookup and label validation  
  [apps/web/lib/services/ens-service.ts](https://github.com/0xgeorgemathew/moonjoy/blob/main/apps/web/lib/services/ens-service.ts#L226-L303)

</details>

<details>
<summary><strong>User ENS claim flow</strong></summary>

Moonjoy validates the label, confirms the caller identity, checks the active agent wallet, and verifies onchain availability before returning the final ENS name.

- User ENS claim preflight route  
  [apps/web/app/api/ens/claim-user-name/route.ts](https://github.com/0xgeorgemathew/moonjoy/blob/main/apps/web/app/api/ens/claim-user-name/route.ts#L11-L135)

</details>

<details>
<summary><strong>ENS text record verification</strong></summary>

Moonjoy does not just trust a submitted transaction hash. It verifies that:

- the user is authenticated
- the ENS name resolves to the expected embedded signer
- the submitted transaction succeeded onchain
- the resulting text record value matches the submitted value

- ENS text record verification route  
  [apps/web/app/api/ens/set-user-text-record/route.ts](https://github.com/0xgeorgemathew/moonjoy/blob/main/apps/web/app/api/ens/set-user-text-record/route.ts#L12-L139)

</details>

<details>
<summary><strong>Public strategy resolution from ENS</strong></summary>

Moonjoy resolves the `moonjoy:strategy` ENS text record, parses the returned pointer, and loads the manifest behind it.

- ENS text record to strategy manifest resolution  
  [apps/web/lib/services/public-strategy-service.ts](https://github.com/0xgeorgemathew/moonjoy/blob/main/apps/web/lib/services/public-strategy-service.ts#L1-L34)

</details>

<details>
<summary><strong>ENS-linked strategy publishing flow</strong></summary>

The strategy studio publishes a manifest pointer from the browser smart wallet into the agent ENS text record, then re-reads the public route to confirm the strategy resolves.

- Strategy publishing transaction to `setText` on the ENS registry  
  [apps/web/components/agent-strategy-studio.tsx](https://github.com/0xgeorgemathew/moonjoy/blob/main/apps/web/components/agent-strategy-studio.tsx#L236-L315)

- Strategy upload and ENS publishing UI copy  
  [apps/web/components/agent-strategy-studio.tsx](https://github.com/0xgeorgemathew/moonjoy/blob/main/apps/web/components/agent-strategy-studio.tsx#L328-L453)

</details>

<details>
<summary><strong>ENS-driven onboarding and agent readiness UX</strong></summary>

Moonjoy explicitly teaches the user that agent ENS bootstrap happens from the smart wallet and exposes ENS-backed strategy status in the interface.

- ENS setup status instructions and active strategy UI  
  [apps/web/components/ens-setup-status.tsx](https://github.com/0xgeorgemathew/moonjoy/blob/main/apps/web/components/ens-setup-status.tsx#L240-L287)

</details>

---

## ▸ Durin Repo References

> **Base repo:** [`https://github.com/0xgeorgemathew/durin`](https://github.com/0xgeorgemathew/durin)
>
> Moonjoy's ENS flow is backed by a Moonjoy-specific Durin registrar contract that encodes the human-agent identity model directly into ENS state.

<details>
<summary><strong>Contract overview and record model</strong></summary>

The registrar defines:

- human names as `label.moonjoy.eth`
- agent names as `agent-label.moonjoy.eth`
- `moonjoy:user` backlink records
- `moonjoy:last_match` and `moonjoy:stats` public provenance pointers
- `moonjoy:match_preference` as a user-owned text record

- Registrar header, constants, storage, and identity model  
  [src/MoonjoyL2Registrar.sol](https://github.com/0xgeorgemathew/durin/blob/main/src/MoonjoyL2Registrar.sol#L1-L121)

</details>

<details>
<summary><strong>Human ENS registration</strong></summary>

This function validates the label, checks availability, builds the initial resolver calls, mints the name, stores the reverse pointer, and optionally stores the authorized bootstrap smart wallet.

- `registerUser`  
  [src/MoonjoyL2Registrar.sol](https://github.com/0xgeorgemathew/durin/blob/main/src/MoonjoyL2Registrar.sol#L123-L158)

</details>

<details>
<summary><strong>Agent ENS registration</strong></summary>

This function derives the agent label from the user label, verifies either the human owner or the authorized bootstrap wallet, and mints the derived agent ENS name directly to the smart wallet with public identity records.

- `registerAgent`  
  [src/MoonjoyL2Registrar.sol](https://github.com/0xgeorgemathew/durin/blob/main/src/MoonjoyL2Registrar.sol#L160-L225)

</details>

<details>
<summary><strong>User text records and bootstrap authorization</strong></summary>

The registrar lets the human ENS owner update match preferences and set the authorized smart wallet that can self-register the agent identity.

- `setUserMatchPreference` and `setAgentBootstrapWallet`  
  [src/MoonjoyL2Registrar.sol](https://github.com/0xgeorgemathew/durin/blob/main/src/MoonjoyL2Registrar.sol#L227-L265)

</details>

<details>
<summary><strong>Public provenance records on the agent ENS name</strong></summary>

Moonjoy can publish match and stats pointers directly onto the agent ENS record.

- `setAgentPublicPointers`  
  [src/MoonjoyL2Registrar.sol](https://github.com/0xgeorgemathew/durin/blob/main/src/MoonjoyL2Registrar.sol#L267-L287)

</details>

<details>
<summary><strong>Public identity resolution and readiness checks</strong></summary>

The registrar exposes a read path for resolving the human-agent graph and a pure ENS-based readiness check that confirms:

- the user name exists
- the derived agent name exists
- the agent name resolves to its owner
- the `moonjoy:user` backlink is correct

- `resolveAgent` and `isAgentReady`  
  [src/MoonjoyL2Registrar.sol](https://github.com/0xgeorgemathew/durin/blob/main/src/MoonjoyL2Registrar.sol#L289-L347)

</details>

<details>
<summary><strong>Availability and reverse lookup helpers</strong></summary>

The registrar exposes checks for user-label and derived-agent availability, plus reverse lookups for human and agent names.

- `available`, `availableAgent`, `getUserName`, and `getAgentName`  
  [src/MoonjoyL2Registrar.sol](https://github.com/0xgeorgemathew/durin/blob/main/src/MoonjoyL2Registrar.sol#L349-L404)

</details>

<details>
<summary><strong>Resolver call construction</strong></summary>

The registrar writes resolver records during registration, including:

- default address resolution
- chain-specific address resolution
- `moonjoy:type`
- `moonjoy:user`
- `moonjoy:match_preference`

- Resolver call builders and helper encoding  
  [src/MoonjoyL2Registrar.sol](https://github.com/0xgeorgemathew/durin/blob/main/src/MoonjoyL2Registrar.sol#L406-L466)

</details>

<details>
<summary><strong>Label derivation and node calculation</strong></summary>

The registrar derives the `agent-` prefix convention and builds namehashes against the Durin base node.

- Label validation and helper functions  
  [src/MoonjoyL2Registrar.sol](https://github.com/0xgeorgemathew/durin/blob/main/src/MoonjoyL2Registrar.sol#L468-L540)

</details>

---

## ▸ Short Submission Copy

> Moonjoy uses ENS as real game infrastructure. Humans claim `label.moonjoy.eth`, agents derive `agent-label.moonjoy.eth`, and we resolve those names onchain for ownership, address resolution, readiness, and public metadata. We also use ENS text records such as `moonjoy:strategy`, `moonjoy:match_preference`, `moonjoy:last_match`, and `moonjoy:stats` so strategy provenance and agent identity stay portable outside our app.
