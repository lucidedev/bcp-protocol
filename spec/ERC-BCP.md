---
eip: DRAFT
title: Business Commerce Protocol (BCP) — Agent-to-Agent Commerce Lifecycle
description: A multi-step negotiation, escrow, and fulfilment protocol for autonomous AI agent commerce, designed as the commerce layer above x402.
author: BCP Contributors
discussions-to: https://github.com/bcp-protocol/bcp/issues
status: Draft
type: Standards Track
category: ERC
created: 2026-04-08
requires: EIP-191, EIP-3009, ERC-8004
---

## Abstract

This ERC defines the **Business Commerce Protocol (BCP)**, a structured message protocol enabling two AI agents to negotiate, commit, fulfil, and dispute a commercial transaction entirely on-chain-backed escrow — without human intervention at each step.

BCP sits **above** the [x402 protocol](https://x402.org) (HTTP 402 Payment Required). Where x402 provides a single-shot payment primitive ("pay and access"), BCP provides the **commerce conversation** that precedes, surrounds, and follows that payment: negotiation, conditional commitment, escrow, delivery verification, invoicing, and disputes.

## Motivation

The x402 ecosystem has achieved 75M+ transactions and $24M+ in volume for pay-per-request API access. However, B2B commerce between agents requires more than a single payment:

1. **Negotiation** — Agents need to exchange quotes, counter-offers, and arrive at mutually agreed terms before committing funds.
2. **Conditional Escrow** — Funds must be locked on commitment and released only upon verified delivery, not fire-and-forget.
3. **Dispute Resolution** — When delivery fails, agents need an on-chain mechanism to freeze funds and negotiate resolution.
4. **Invoice Compliance** — B2B transactions require structured invoices (UBL 2.1) for accounting and tax compliance.
5. **State Tracking** — Each deal must progress through a deterministic state machine so both parties share consensus on deal status.

No existing standard addresses the full commerce lifecycle. ERC-8004 provides agent identity. x402 provides payment. BCP provides the commerce logic between those two layers.

## Specification

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in RFC 2119.

### Protocol Version

Current version: `0.3`. All messages carry a `bcp_version` field. Implementations MUST reject messages with an unsupported version.

### Transport

| Property | Value |
|---|---|
| Protocol | HTTPS |
| Format | JSON (`Content-Type: application/json`) |
| Method | POST |
| Authentication | Ed25519 message-level signatures (optional per-session) |

#### Endpoint

Each BCP node exposes a single unified endpoint:

```
POST /bcp    — Submit any BCP message
```

The `type` field in the request body determines the message kind. Successful responses return `200 OK` with:
```json
{ "accepted": true, "sessionId": "<uuid>", "state": "<state>" }
```

### Message Signing (Ed25519)

Every BCP message MUST be signed:

1. Construct message JSON **without** the `signature` field.
2. Serialize to canonical JSON (keys sorted lexicographically, no whitespace).
3. Compute Ed25519 signature over the UTF-8 bytes.
4. Set `signature` field to the hex-encoded signature string.

Verification reverses this process. Invalid signatures MUST be rejected with error code `BCP_001`.

### Message Types

All messages share a common envelope (`BCPEnvelope`):

```typescript
{
  bcp_version: "0.3",         // Protocol version
  type: string,               // Message kind (lowercase)
  sessionId: string,          // Session identifier (set by buyer in INTENT)
  timestamp: string,          // ISO 8601 creation time
  callbackUrl?: string,       // URL for async response delivery
  signature?: string,         // Ed25519 hex signature
  did?: string                // DID identifier of the sender
}
```

#### INTENT — Buyer Declares Procurement Need

```typescript
{
  bcp_version: "0.3",
  type: "intent",
  sessionId: UUID,
  timestamp: ISO8601,
  service: string,             // What the buyer needs (natural language)
  budget?: number,             // Maximum budget
  currency?: string,           // e.g. "USD", "USDC"
  auth?: AuthMode,             // "none"|"platform"|"ed25519"|"did"
  rfqId?: UUID,                // Shared ID for multi-seller RFQ broadcasts
  agentUrl?: string,           // Seller's A2A Agent Card URL
  callbackUrl?: string,
  signature?: string,
  did?: string
}
```

#### QUOTE — Seller Responds with Offer

```typescript
{
  bcp_version: "0.3",
  type: "quote",
  sessionId: UUID,             // References the INTENT session
  timestamp: ISO8601,
  price: number,               // Offered price
  currency: string,            // Currency code
  deliverables?: string[],     // What the buyer will receive
  estimatedDays?: number,      // Delivery estimate
  validUntil?: ISO8601,        // Quote expiry
  settlement?: Settlement,     // "none"|"invoice"|"x402"|"escrow"
  callbackUrl?: string,
  signature?: string,
  did?: string
}
```

#### COUNTER — Either Party Proposes Modified Terms

```typescript
{
  bcp_version: "0.3",
  type: "counter",
  sessionId: UUID,             // Same session
  timestamp: ISO8601,
  counterPrice: number,        // Proposed price
  reason?: string,             // Justification
  callbackUrl?: string,
  signature?: string,
  did?: string
}
```

#### COMMIT — Buyer Accepts and Locks Escrow

```typescript
{
  bcp_version: "0.3",
  type: "commit",
  sessionId: UUID,
  timestamp: ISO8601,
  agreedPrice: number,         // Committed price
  currency: string,            // Currency code
  settlement?: Settlement,     // How payment will be settled
  escrow?: {
    contractAddress: string,   // On-chain escrow contract
    txHash?: string            // Lock transaction hash
  },
  callbackUrl?: string,
  signature?: string,
  did?: string
}
```

#### FULFIL — Seller Confirms Delivery

```typescript
{
  bcp_version: "0.3",
  type: "fulfil",
  sessionId: UUID,
  timestamp: ISO8601,
  deliverables?: string[],     // What was delivered
  summary?: string,            // Work summary
  proofHash?: string,          // SHA-256 of delivery evidence
  invoiceUrl?: string,         // URL to formal invoice
  callbackUrl?: string,
  signature?: string,
  did?: string
}
```

#### ACCEPT — Buyer Confirms Receipt

```typescript
{
  bcp_version: "0.3",
  type: "accept",
  sessionId: UUID,
  timestamp: ISO8601,
  fulfilHash?: string,         // SHA-256 hash of accepted FULFIL
  rating?: number,             // 1-5 buyer rating
  feedback?: string,           // Optional buyer feedback
  callbackUrl?: string,
  signature?: string,
  did?: string
}
```

#### DISPUTE — Either Party Freezes Escrow

```typescript
{
  bcp_version: "0.3",
  type: "dispute",
  sessionId: UUID,
  timestamp: ISO8601,
  reason: string,              // What went wrong
  resolution?: "refund"|"redeliver"|"negotiate",
  callbackUrl?: string,
  signature?: string,
  did?: string
}
```

### State Machine

#### States

| State | Description |
|---|---|
| `intent` | INTENT received, awaiting quotes |
| `quoted` | QUOTE received, buyer may counter or commit |
| `countered` | COUNTER received, negotiation in progress |
| `committed` | Escrow locked, awaiting delivery |
| `fulfilled` | Delivery confirmed, escrow released |
| `accepted` | Buyer confirmed receipt |
| `disputed` | Escrow frozen, resolution pending |

#### Transition Table

| From State | Message | To State |
|---|---|---|
| `intent` | quote | `quoted` |
| `quoted` | counter | `countered` |
| `quoted` | commit | `committed` |
| `countered` | counter | `countered` |
| `countered` | quote | `quoted` |
| `countered` | commit | `committed` |
| `committed` | fulfil | `fulfilled` |
| `committed` | dispute | `disputed` |
| `fulfilled` | accept | `accepted` |
| `disputed` | unfrozen | `committed` |

Any transition not listed MUST be rejected with error `BCP_003`.

### Escrow Contract Interface

The BCP escrow contract MUST implement:

```solidity
interface IBCPEscrow {
    function lock(bytes32 commitId, address buyer, address seller, uint256 releaseAfter) external payable;
    function lockToken(bytes32 commitId, address buyer, address seller, uint256 releaseAfter, address token, uint256 amount) external;
    function release(bytes32 commitId) external;
    function freeze(bytes32 commitId) external;
    function approveUnfreeze(bytes32 commitId) external;
}
```

**Lock**: Called by buyer on COMMIT. Funds held until release conditions met.
**Release**: Called by seller after `releaseAfter` timestamp. Transfers funds to seller.
**Freeze**: Called by either party on DISPUTE. Prevents release.
**ApproveUnfreeze**: Requires 2-of-2 (both buyer AND seller) to return escrow to Locked state.

### x402 Integration

BCP is designed as a **layer above x402**, not a replacement:

```
┌─────────────────────────────────────────┐
│  BCP Layer (Negotiation → Fulfilment)   │
│  INTENT → QUOTE → COMMIT → FULFIL      │
├─────────────────────────────────────────┤
│  x402 Layer (Payment Primitive)         │
│  HTTP 402 → Sign → Pay → Access        │
├─────────────────────────────────────────┤
│  Settlement (Base, Ethereum, etc.)      │
│  USDC / ETH / ERC-20                   │
└─────────────────────────────────────────┘
```

#### x402-Funded Escrow

A BCP escrow lock MAY be funded via an x402 payment flow:

1. Buyer agent sends COMMIT to seller.
2. Seller's BCP server responds with `402 Payment Required` containing escrow lock parameters.
3. Buyer's x402 client signs a `transferWithAuthorization` (EIP-3009) for the escrow amount.
4. The x402 facilitator verifies and settles the lock into the BCP escrow contract.
5. Seller's BCP server confirms the lock and returns `200 OK`.

This allows existing x402 facilitators (Coinbase, etc.) to serve as the funding rail for BCP escrow, unifying the payment and commerce layers.

### Payment Terms

| Term | Escrow Lock | x402 Settlement Trigger |
|---|---|---|
| `immediate` | Full amount on COMMIT | On FULFIL confirmation |
| `net15` | Full amount on COMMIT | 15 days after FULFIL |
| `net30` | Full amount on COMMIT | 30 days after FULFIL |
| `net45`–`net90` | Full amount on COMMIT | N days after FULFIL |

### Security Considerations

1. All messages MUST be transmitted over HTTPS.
2. Signature verification is mandatory — reject invalid signatures with `BCP_001`.
3. Replay protection — track processed message IDs, reject duplicates.
4. Timestamp validation — reject messages >5 minutes stale.
5. Budget enforcement — COMMIT `agreedPrice` MUST NOT exceed buyer's `budget` from the original INTENT.
6. Escrow contract MUST be permissionless — no admin keys, no upgrade proxy.

### Error Codes

| Code | Name | Description |
|---|---|---|
| `BCP_001` | Invalid Signature | Ed25519 verification failed |
| `BCP_002` | Expired Message | Timestamp + TTL elapsed or validity_until passed |
| `BCP_003` | Invalid State Transition | Message not valid for current session state |
| `BCP_004` | Insufficient Escrow | Amount doesn't match committed offer |
| `BCP_005` | Unknown Reference | Referenced ID not found |

## Rationale

### Why Not Extend x402?

x402 is intentionally minimal — a single HTTP header exchange for payment. Commerce requires multi-message state, negotiation rounds, conditional escrow, and dispute mechanisms that would violate x402's design philosophy of simplicity.

### Why Ed25519 Over ECDSA?

BCP messages are application-layer objects, not EVM transactions. Ed25519 provides faster verification, deterministic signatures, and no malleability — well-suited for high-frequency agent-to-agent messaging. EVM keys (ECDSA/secp256k1) are used exclusively for on-chain escrow operations.

### Why UBL 2.1 Invoices?

UBL 2.1 is the ISO/IEC 19845:2015 standard adopted by the EU (EN 16931), Australia, New Zealand, and Singapore for electronic invoicing. Using a global standard ensures BCP invoices are legally valid in 60+ jurisdictions.

### Why 2-of-2 Multisig for Disputes?

The `approveUnfreeze` mechanism requires BOTH buyer and seller to agree before frozen funds can move. This prevents unilateral resolution while keeping the protocol simple. Future versions may introduce third-party arbitrators or DAO governance.

## Backwards Compatibility

This is a new standard with no backwards compatibility concerns. BCP messages include a `bcp_version` field to support future protocol evolution.

## Reference Implementation

TypeScript reference implementation: [`@bcp-protocol/sdk`](https://github.com/lucidedev/bcp-protocol)

```typescript
import { BCPBuyer } from 'bcp-protocol';
import { BCPSeller } from 'bcp-protocol';

// Buyer: negotiate and purchase
const buyer = new BCPBuyer({ network: 'base-sepolia', evmPrivateKey: '0x...' });
const deal = await buyer.purchase({
  seller: 'https://seller.example.com',
  service: 'cloud-compute',
  budget: 50,
  currency: 'USDC',
});

// Seller: listen and fulfil
const seller = new BCPSeller({ network: 'base-sepolia', evmPrivateKey: '0x...' });
seller.listen({
  port: 3001,
  pricing: (intent) => ({ price: 45, description: 'GPU hours' }),
});
```

Deployed escrow contract (Base Sepolia): `0xA5cB314e1dE37e0B6Fc4Fbf29B0bc4836c359fb2`

## Security Considerations

- **Escrow contract**: Permissionless, no admin keys, no proxy upgrades. Funds are controlled solely by protocol rules.
- **Message replay**: Implementations MUST track processed message IDs and reject duplicates.
- **Key management**: Agent Ed25519 keys and EVM private keys MUST be stored securely. Implementations SHOULD support hardware wallets and key management services.
- **Budget enforcement**: Buyer agents MUST enforce `budget` checks before committing escrow. Servers MUST reject COMMIT messages exceeding the buyer's declared budget.
- **Front-running**: Escrow lock transactions use `sessionId` as a unique identifier (keccak256 hash), preventing duplicate locks.

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
