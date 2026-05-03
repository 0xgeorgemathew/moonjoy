<div align="center">

# 0 G   C O D E   U S A G E

[![0G Storage](https://img.shields.io/badge/0G-Strategy_Storage-1E88E5?style=flat-square)](https://0g.ai)
[![AES-256](https://img.shields.io/badge/Encryption-AES--256_GCM-E53935?style=flat-square)](https://en.wikipedia.org/wiki/Advanced_Encryption_Standard)
[![ENS](https://img.shields.io/badge/ENS-Strategy_Resolution-5298FF?style=flat-square&logo=ethereum)](https://ens.domains)

</div>

---

This document is the detailed 0G prize support file for Moonjoy.

Moonjoy uses 0G Storage as the durable content layer for agent strategy manifests. Public strategies are uploaded as readable manifests and later resolved through ENS text records. Secret strategies are encrypted before upload so the manifest pointer can still be published while the underlying strategy remains MCP-only.

---

## ▸ Prize Narrative

> Moonjoy uses 0G for three concrete jobs:
>
> 1. **Strategy manifest storage**
> Public and secret strategy manifests are uploaded to 0G and stored as pointers in Moonjoy.
>
> 2. **Portable strategy provenance**
> Public strategy pointers can be written to ENS text records so the strategy can be resolved outside the Moonjoy database.
>
> 3. **Controlled private strategy access**
> Secret strategy manifests are encrypted before upload and only decrypted through Moonjoy's controlled server-side path.

---

## ▸ Core 0G Integration

<details>
<summary><strong>0G storage service</strong></summary>

This is the direct 0G SDK integration. It configures the Indexer, creates canonical JSON payloads, uploads them, returns a `0g://` pointer, and can later download the manifest back from 0G.

- 0G SDK imports, environment config, upload flow, pointer construction, and download flow  
  [apps/web/lib/services/zero-g-storage-service.ts](https://github.com/0xgeorgemathew/moonjoy/blob/main/apps/web/lib/services/zero-g-storage-service.ts#L1-L132)

</details>

---

## ▸ Secret Strategy Handling

Secret strategies are encrypted before upload so Moonjoy can publish a pointer without publishing readable strategy contents.

<details>
<summary><strong>Encryption and decryption logic</strong></summary>

- Secret manifest preview, AES-256-GCM encryption, and decryption logic  
  [apps/web/lib/services/strategy-secret-service.ts](https://github.com/0xgeorgemathew/moonjoy/blob/main/apps/web/lib/services/strategy-secret-service.ts#L1-L119)

</details>

---

## ▸ Strategy Creation Path

When a strategy is created, Moonjoy:

- normalizes the manifest
- chooses public or secret mode
- uploads the manifest to 0G
- stores the returned `manifest_pointer`
- optionally syncs public ENS records later

<details>
<summary><strong>Strategy creation with 0G upload</strong></summary>

- Strategy creation with 0G upload and pointer persistence  
  [apps/web/lib/services/agent-bootstrap-service.ts](https://github.com/0xgeorgemathew/moonjoy/blob/main/apps/web/lib/services/agent-bootstrap-service.ts#L445-L523)

</details>

When a strategy is updated, Moonjoy re-uploads the changed manifest to 0G and stores the new pointer:

<details>
<summary><strong>Strategy re-upload path on update</strong></summary>

- Strategy re-upload path on update  
  [apps/web/lib/services/agent-bootstrap-service.ts](https://github.com/0xgeorgemathew/moonjoy/blob/main/apps/web/lib/services/agent-bootstrap-service.ts#L551-L566)

</details>

---

## ▸ Strategy API Path

The authenticated strategy route creates a strategy through the bootstrap service and returns submission-friendly notes that explicitly mention the 0G upload result and deferred ENS publication.

<details>
<summary><strong>Strategy creation API route</strong></summary>

- Strategy creation API route and 0G-specific response note  
  [apps/web/app/api/agents/strategy/route.ts](https://github.com/0xgeorgemathew/moonjoy/blob/main/apps/web/app/api/agents/strategy/route.ts#L102-L210)

</details>

---

## ▸ ENS + 0G Resolution Path

Moonjoy reads the public strategy by:

- resolving the ENS text record
- parsing the stored `0g://` pointer
- downloading the manifest from 0G

<details>
<summary><strong>ENS text record to 0G manifest resolution</strong></summary>

- ENS text record to 0G manifest resolution  
  [apps/web/lib/services/public-strategy-service.ts](https://github.com/0xgeorgemathew/moonjoy/blob/main/apps/web/lib/services/public-strategy-service.ts#L1-L34)

</details>

---

## ▸ Product UI That Surfaces 0G Usage

The strategy studio explicitly lets the user upload a strategy manifest to 0G, choose public or secret mode, and then publish the returned pointer to ENS.

<details>
<summary><strong>Strategy studio 0G integration</strong></summary>

- Default 0G test strategy manifest and 0G upload flow  
  [apps/web/components/agent-strategy-studio.tsx](https://github.com/0xgeorgemathew/moonjoy/blob/main/apps/web/components/agent-strategy-studio.tsx#L49-L67)

- Authenticated strategy upload flow to `/api/agents/strategy`  
  [apps/web/components/agent-strategy-studio.tsx](https://github.com/0xgeorgemathew/moonjoy/blob/main/apps/web/components/agent-strategy-studio.tsx#L169-L234)

- ENS publication flow for the returned 0G pointer  
  [apps/web/components/agent-strategy-studio.tsx](https://github.com/0xgeorgemathew/moonjoy/blob/main/apps/web/components/agent-strategy-studio.tsx#L236-L315)

- User-facing product copy explaining 0G-backed public and secret strategy behavior  
  [apps/web/components/agent-strategy-studio.tsx](https://github.com/0xgeorgemathew/moonjoy/blob/main/apps/web/components/agent-strategy-studio.tsx#L339-L443)

</details>

The ENS setup panel also surfaces that the public active strategy is readable from ENS and 0G:

<details>
<summary><strong>ENS setup status referencing 0G</strong></summary>

- ENS setup status copy referencing ENS + 0G  
  [apps/web/components/ens-setup-status.tsx](https://github.com/0xgeorgemathew/moonjoy/blob/main/apps/web/components/ens-setup-status.tsx#L267-L284)

</details>

---

## ▸ Short Submission Copy

> Moonjoy uses 0G Storage to publish agent strategy manifests and return portable `0g://` pointers. Public strategies can then be resolved through ENS text records, while secret strategies are encrypted before upload so they remain MCP-only. That makes strategy provenance portable and verifiable without forcing all strategy logic to live in our private database.
