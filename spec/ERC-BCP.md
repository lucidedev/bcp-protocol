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

Current version: `0.1`. All messages carry a `bcp_version` field. Implementations MUST reject messages with an unsupported version.

### Transport

| Property | Value |
|---|---|
| Protocol | HTTPS |
| Format | JSON (`Content-Type: application/json`) |
| Method | POST |
| Authentication | Ed25519 message-level signatures |

#### Endpoints

Each BCP node exposes:

```
POST /bcp/intent    — Submit INTENT
POST /bcp/quote     — Submit QUOTE
POST /bcp/counter   — Submit COUNTER
POST /bcp/commit    — Submit COMMIT
POST /bcp/fulfil    — Submit FULFIL
POST /bcp/dispute   — Submit DISPUTE
```

Successful responses return `200 OK` with:
```json
{ "accepted": true, "message_id": "<uuid>", "session_state": "<state>" }
```

### Message Signing (Ed25519)

Every BCP message MUST be signed:

1. Construct message JSON **without** the `signature` field.
2. Serialize to canonical JSON (keys sorted lexicographically, no whitespace).
3. Compute Ed25519 signature over the UTF-8 bytes.
4. Set `signature` field to the hex-encoded signature string.

Verification reverses this process. Invalid signatures MUST be rejected with error code `BCP_001`.

### Message Types

#### INTENT — Buyer Declares Procurement Need

```typescript
{
  bcp_version: "0.1",
  message_type: "INTENT",
  intent_id: UUID,             // Unique identifier
  timestamp: ISO8601,          // Creation time
  buyer: {
    org_id: string,            // Organization identifier
    agent_wallet_address: string, // EVM address
    credential: string,        // Ed25519 public key
    spending_limit: number,    // Max authorized spend
    currency: string           // e.g. "USDC"
  },
  requirements: {
    category: string,          // Product/service category
    quantity: number,
    delivery_window: string,
    budget_max: number,
    payment_terms_acceptable: string[] // ["immediate","net30",...]
  },
  ttl: integer,                // Time to live (seconds)
  rfq_id?: UUID,               // Optional: multi-seller RFQ broadcast ID
  signature: string
}
```

#### QUOTE — Seller Responds with Offer

```typescript
{
  bcp_version: "0.1",
  message_type: "QUOTE",
  quote_id: UUID,
  intent_id: UUID,             // References the INTENT
  timestamp: ISO8601,
  seller: {
    org_id: string,
    agent_wallet_address: string,
    credential: string
  },
  offer: {
    price: number,             // Total price
    currency: string,
    payment_terms: string,     // "immediate"|"net15"|...|"net90"
    delivery_date: ISO8601,
    validity_until: ISO8601,   // Quote expiry
    line_items: [{
      description: string,
      qty: number,
      unit_price: number,
      unit: string
    }],
    early_pay_discount?: {
      discount_percent: number,
      if_paid_within_days: integer
    }
  },
  signature: string
}
```

#### COUNTER — Either Party Proposes Modified Terms

```typescript
{
  bcp_version: "0.1",
  message_type: "COUNTER",
  counter_id: UUID,
  ref_id: UUID,                // References quote_id or counter_id
  initiated_by: "buyer"|"seller",
  timestamp: ISO8601,
  proposed_changes: {          // Same schema as `offer`
    price?: number,
    payment_terms?: string,
    delivery_date?: ISO8601,
    line_items?: [...]
  },
  rationale?: string,
  new_validity_until: ISO8601,
  signature: string
}
```

#### COMMIT — Buyer Accepts and Locks Escrow

```typescript
{
  bcp_version: "0.1",
  message_type: "COMMIT",
  commit_id: UUID,
  accepted_ref_id: UUID,       // References accepted quote_id/counter_id
  timestamp: ISO8601,
  buyer_approval: {
    approved_by: string,       // Approver wallet address
    approval_type: "autonomous"|"human_required",
    threshold_exceeded: boolean
  },
  escrow: {
    amount: number,
    currency: string,
    escrow_contract_address: string,
    release_condition: "fulfil_confirmed"|"dispute_timeout_72h",
    payment_schedule: {
      type: string,            // Matches payment_terms
      due_date: ISO8601
    }
  },
  signature: string
}
```

#### FULFIL — Seller Confirms Delivery

```typescript
{
  bcp_version: "0.1",
  message_type: "FULFIL",
  fulfil_id: UUID,
  commit_id: UUID,
  timestamp: ISO8601,
  delivery_proof: {
    type: "api_verified"|"hash"|"delivery_receipt"|"service_confirmation",
    evidence: string
  },
  invoice: {
    format: "UBL2.1",
    invoice_id: string,
    invoice_hash: string,      // SHA-256 of UBL XML
    invoice_url: string
  },
  settlement_trigger: "immediate"|"scheduled",
  signature: string
}
```

#### DISPUTE — Either Party Freezes Escrow

```typescript
{
  bcp_version: "0.1",
  message_type: "DISPUTE",
  dispute_id: UUID,
  commit_id: UUID,
  timestamp: ISO8601,
  raised_by: "buyer"|"seller",
  reason: "partial_delivery"|"non_delivery"|"quality_issue"|"payment_failure"|"other",
  evidence_hash?: string,
  evidence_url?: string,
  requested_resolution: "full_refund"|"partial_refund"|"redeliver"|"negotiate",
  signature: string
}
```

### State Machine

#### States

| State | Description |
|---|---|
| `INITIATED` | INTENT received, awaiting quotes |
| `QUOTED` | QUOTE received, buyer may counter or commit |
| `COUNTERED` | COUNTER received, negotiation in progress |
| `COMMITTED` | Escrow locked, awaiting delivery |
| `FULFILLED` | Delivery confirmed, escrow released |
| `DISPUTED` | Escrow frozen, resolution pending |

#### Transition Table

| From State | Message | To State |
|---|---|---|
| `INITIATED` | QUOTE | `QUOTED` |
| `QUOTED` | COUNTER | `COUNTERED` |
| `QUOTED` | COMMIT | `COMMITTED` |
| `COUNTERED` | COUNTER | `COUNTERED` |
| `COUNTERED` | QUOTE | `QUOTED` |
| `COUNTERED` | COMMIT | `COMMITTED` |
| `COMMITTED` | FULFIL | `FULFILLED` |
| `COMMITTED` | DISPUTE | `DISPUTED` |
| `DISPUTED` | UNFROZEN | `COMMITTED` |

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
5. Spending limit enforcement — COMMIT amount MUST NOT exceed buyer's `spending_limit`.
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

TypeScript reference implementation: [`@bcp-protocol/sdk`](https://github.com/bcp-protocol/bcp)

```typescript
import { BCPBuyer } from '@bcp-protocol/sdk/buyer';
import { BCPSeller } from '@bcp-protocol/sdk/seller';

// Buyer: negotiate and purchase
const buyer = new BCPBuyer({ network: 'base-sepolia', evmPrivateKey: '0x...' });
const deal = await buyer.purchase({
  sellerUrl: 'https://seller.example.com',
  category: 'cloud-compute',
  quantity: 100,
  budgetMax: 50,
  currency: 'USDC',
});

// Seller: listen and fulfil
const seller = new BCPSeller({ network: 'base-sepolia', evmPrivateKey: '0x...' });
seller.listen({
  port: 3001,
  pricing: (intent) => ({ unitPrice: 0.45, description: 'GPU hours' }),
});
```

Deployed escrow contract (Base Sepolia): `0xA5cB314e1dE37e0B6Fc4Fbf29B0bc4836c359fb2`

## Security Considerations

- **Escrow contract**: Permissionless, no admin keys, no proxy upgrades. Funds are controlled solely by protocol rules.
- **Message replay**: Implementations MUST track processed message IDs and reject duplicates.
- **Key management**: Agent Ed25519 keys and EVM private keys MUST be stored securely. Implementations SHOULD support hardware wallets and key management services.
- **Spending limits**: Buyer agents MUST enforce `spending_limit` checks before committing escrow. Servers MUST reject COMMIT messages exceeding the buyer's declared limit.
- **Front-running**: Escrow lock transactions use `commitId` as a unique identifier (keccak256 hash), preventing duplicate locks.

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
