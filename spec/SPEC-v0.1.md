# BCP — Business Commerce Protocol Specification

**Version:** 0.1  
**Status:** Draft  
**Date:** 2026-04-07  
**License:** Apache 2.0  

---

## 1. Overview

The Business Commerce Protocol (BCP) is an open protocol that defines structured commerce conversations between two AI agents representing business organizations. BCP sits above the [x402 protocol](https://www.x402.org/) by Coinbase — x402 handles the stablecoin payment primitive over HTTP using the `402 Payment Required` status code, while BCP defines the negotiation, commitment, fulfilment, and dispute lifecycle that occurs *before and around* that payment.

### 1.1 Design Principles

1. **x402-native settlement** — BCP never replaces or forks x402. All settlement flows through x402's HTTP 402 mechanism.
2. **Agent-first** — Every message is created and consumed by AI agents operating on behalf of organizations.
3. **Cryptographically signed** — Every message is signed by the sender's Ed25519 private key. The receiver verifies using the sender's declared public key.
4. **Deterministic state machine** — Valid message transitions are strictly defined. Invalid transitions are rejected.
5. **Escrow-backed commitments** — Buyer commits are backed by locked escrow. Disputes freeze escrow until resolution.
6. **Open and extensible** — The protocol is designed for extension while maintaining backward compatibility within a major version.

### 1.2 Versioning

BCP uses semantic versioning. The current version is `0.1`. All messages carry a `bcp_version` field. Receivers MUST reject messages with an unsupported version.

---

## 2. Transport

- **Protocol:** HTTPS
- **Format:** JSON (`Content-Type: application/json`)
- **Method:** POST for all message submissions
- **Authentication:** Ed25519 message-level signatures (see §3)
- **Endpoints:**

| Endpoint | Description |
|---|---|
| `POST /bcp/intent` | Submit an INTENT message |
| `POST /bcp/quote` | Submit a QUOTE message |
| `POST /bcp/counter` | Submit a COUNTER message |
| `POST /bcp/commit` | Submit a COMMIT message |
| `POST /bcp/fulfil` | Submit a FULFIL message |
| `POST /bcp/dispute` | Submit a DISPUTE message |

All endpoints return:
- `200 OK` with `{ "accepted": true, "message_id": "<id>" }` on success
- `400 Bad Request` with a BCP error object on validation failure
- `403 Forbidden` on signature verification failure
- `409 Conflict` on invalid state transition

---

## 3. Authentication

Every BCP message MUST be signed by the sending agent's Ed25519 private key.

### 3.1 Signing

1. Construct the message payload as a JSON object **without** the `signature` field.
2. Serialize to canonical JSON (keys sorted lexicographically, no whitespace).
3. Compute the Ed25519 signature over the UTF-8 bytes of the canonical JSON string.
4. Encode the signature as a hex string and set it as the `signature` field.

### 3.2 Verification

1. Extract the `signature` field from the received message.
2. Remove the `signature` field from the message.
3. Serialize the remaining payload to canonical JSON (sorted keys, no whitespace).
4. Verify the Ed25519 signature using the sender's public key (declared in their `credential` field or resolved from their `agent_wallet_address`).
5. If verification fails, reject with error code `BCP_001`.

---

## 4. Message Types

### 4.1 INTENT

Buyer agent declares a procurement need.

| Field | Type | Required | Description |
|---|---|---|---|
| `bcp_version` | string | ✅ | Protocol version, must be `"0.1"` |
| `message_type` | string | ✅ | Must be `"INTENT"` |
| `intent_id` | string (UUID v4) | ✅ | Unique identifier for this intent |
| `timestamp` | string (ISO 8601) | ✅ | Creation timestamp |
| `buyer` | object | ✅ | Buyer identity and authorization |
| `buyer.org_id` | string | ✅ | Buyer organization identifier |
| `buyer.agent_wallet_address` | string | ✅ | Buyer agent's wallet address |
| `buyer.credential` | string | ✅ | Public key or verifiable credential |
| `buyer.spending_limit` | number | ✅ | Maximum authorized spend |
| `buyer.currency` | string | ✅ | Currency code (e.g. `USDC`) |
| `requirements` | object | ✅ | Procurement requirements |
| `requirements.category` | string | ✅ | Product/service category |
| `requirements.quantity` | number | ✅ | Quantity needed |
| `requirements.delivery_window` | string | ✅ | Desired delivery window |
| `requirements.budget_max` | number | ✅ | Maximum budget |
| `requirements.payment_terms_acceptable` | string[] | ✅ | Acceptable terms: `immediate`, `net15`, `net30`, `net45`, `net60`, `net90` |
| `requirements.compliance` | string[] | ❌ | Compliance requirements |
| `ttl` | integer | ✅ | Time to live in seconds |
| `signature` | string | ✅ | Ed25519 hex signature |

### 4.2 QUOTE

Seller agent responds with a signed offer.

| Field | Type | Required | Description |
|---|---|---|---|
| `bcp_version` | string | ✅ | `"0.1"` |
| `message_type` | string | ✅ | `"QUOTE"` |
| `quote_id` | string (UUID v4) | ✅ | Unique quote identifier |
| `intent_id` | string (UUID v4) | ✅ | Reference to the INTENT |
| `timestamp` | string (ISO 8601) | ✅ | Creation timestamp |
| `seller` | object | ✅ | Seller identity |
| `seller.org_id` | string | ✅ | Seller organization identifier |
| `seller.agent_wallet_address` | string | ✅ | Seller agent's wallet address |
| `seller.credential` | string | ✅ | Public key or verifiable credential |
| `offer` | object | ✅ | The commercial offer |
| `offer.price` | number | ✅ | Total price |
| `offer.currency` | string | ✅ | Currency code |
| `offer.payment_terms` | string | ✅ | One of: `immediate`, `net15`, `net30`, `net45`, `net60`, `net90` |
| `offer.delivery_date` | string (ISO 8601) | ✅ | Expected delivery date |
| `offer.validity_until` | string (ISO 8601) | ✅ | Quote expiry timestamp |
| `offer.line_items` | array | ✅ | Line items (min 1) |
| `offer.line_items[].description` | string | ✅ | Item description |
| `offer.line_items[].qty` | number | ✅ | Quantity |
| `offer.line_items[].unit_price` | number | ✅ | Unit price |
| `offer.line_items[].unit` | string | ✅ | Unit of measure |
| `offer.early_pay_discount` | object | ❌ | Early payment discount |
| `offer.early_pay_discount.discount_percent` | number | ✅* | Discount percentage |
| `offer.early_pay_discount.if_paid_within_days` | integer | ✅* | Days within which payment qualifies |
| `signature` | string | ✅ | Ed25519 hex signature |

*Required if `early_pay_discount` object is present.

### 4.3 COUNTER

Either party proposes modified terms.

| Field | Type | Required | Description |
|---|---|---|---|
| `bcp_version` | string | ✅ | `"0.1"` |
| `message_type` | string | ✅ | `"COUNTER"` |
| `counter_id` | string (UUID v4) | ✅ | Unique counter identifier |
| `ref_id` | string (UUID v4) | ✅ | Reference to quote_id or counter_id being countered |
| `initiated_by` | string | ✅ | `"buyer"` or `"seller"` |
| `timestamp` | string (ISO 8601) | ✅ | Creation timestamp |
| `proposed_changes` | object | ✅ | Modified offer fields (same schema as `offer`) |
| `rationale` | string | ❌ | Explanation for the counter |
| `new_validity_until` | string (ISO 8601) | ✅ | Validity of this counter |
| `signature` | string | ✅ | Ed25519 hex signature |

### 4.4 COMMIT

Buyer accepts the offer and locks escrow.

| Field | Type | Required | Description |
|---|---|---|---|
| `bcp_version` | string | ✅ | `"0.1"` |
| `message_type` | string | ✅ | `"COMMIT"` |
| `commit_id` | string (UUID v4) | ✅ | Unique commit identifier |
| `accepted_ref_id` | string (UUID v4) | ✅ | Reference to accepted quote_id or counter_id |
| `timestamp` | string (ISO 8601) | ✅ | Creation timestamp |
| `buyer_approval` | object | ✅ | Approval details |
| `buyer_approval.approved_by` | string | ✅ | Approver wallet address |
| `buyer_approval.approval_type` | string | ✅ | `"autonomous"` or `"human_required"` |
| `buyer_approval.threshold_exceeded` | boolean | ✅ | Whether spending threshold exceeded |
| `escrow` | object | ✅ | Escrow details |
| `escrow.amount` | number | ✅ | Escrowed amount |
| `escrow.currency` | string | ✅ | Currency code |
| `escrow.escrow_contract_address` | string | ✅ | Escrow contract address |
| `escrow.release_condition` | string | ✅ | `"fulfil_confirmed"` or `"dispute_timeout_72h"` |
| `escrow.payment_schedule` | object | ✅ | Payment schedule |
| `escrow.payment_schedule.type` | string | ✅ | Matches payment_terms enum |
| `escrow.payment_schedule.due_date` | string (ISO 8601) | ✅ | Payment due date |
| `po_reference` | string | ❌ | Purchase order reference |
| `signature` | string | ✅ | Ed25519 hex signature |

### 4.5 FULFIL

Seller confirms delivery and triggers escrow release.

| Field | Type | Required | Description |
|---|---|---|---|
| `bcp_version` | string | ✅ | `"0.1"` |
| `message_type` | string | ✅ | `"FULFIL"` |
| `fulfil_id` | string (UUID v4) | ✅ | Unique fulfilment identifier |
| `commit_id` | string (UUID v4) | ✅ | Reference to the COMMIT being fulfilled |
| `timestamp` | string (ISO 8601) | ✅ | Creation timestamp |
| `delivery_proof` | object | ✅ | Proof of delivery |
| `delivery_proof.type` | string | ✅ | `"api_verified"`, `"hash"`, `"delivery_receipt"`, or `"service_confirmation"` |
| `delivery_proof.evidence` | string | ✅ | Evidence string |
| `invoice` | object | ✅ | Invoice details |
| `invoice.format` | string | ✅ | Must be `"UBL2.1"` |
| `invoice.invoice_id` | string | ✅ | Invoice identifier |
| `invoice.invoice_hash` | string | ✅ | SHA-256 hash of the UBL invoice XML |
| `invoice.invoice_url` | string (URI) | ✅ | URL to retrieve the invoice |
| `settlement_trigger` | string | ✅ | `"immediate"` or `"scheduled"` |
| `signature` | string | ✅ | Ed25519 hex signature |

### 4.6 DISPUTE

Either party freezes escrow and raises an issue.

| Field | Type | Required | Description |
|---|---|---|---|
| `bcp_version` | string | ✅ | `"0.1"` |
| `message_type` | string | ✅ | `"DISPUTE"` |
| `dispute_id` | string (UUID v4) | ✅ | Unique dispute identifier |
| `commit_id` | string (UUID v4) | ✅ | Reference to the COMMIT under dispute |
| `timestamp` | string (ISO 8601) | ✅ | Creation timestamp |
| `raised_by` | string | ✅ | `"buyer"` or `"seller"` |
| `reason` | string | ✅ | `"partial_delivery"`, `"non_delivery"`, `"quality_issue"`, `"payment_failure"`, or `"other"` |
| `evidence_hash` | string | ❌ | SHA-256 hash of evidence |
| `evidence_url` | string (URI) | ❌ | URL to evidence |
| `requested_resolution` | string | ✅ | `"full_refund"`, `"partial_refund"`, `"redeliver"`, or `"negotiate"` |
| `signature` | string | ✅ | Ed25519 hex signature |

---

## 5. State Machine

### 5.1 States

| State | Description |
|---|---|
| `INITIATED` | INTENT received, awaiting quotes |
| `QUOTED` | QUOTE received, awaiting counter or commit |
| `COUNTERED` | COUNTER received, awaiting counter or commit |
| `COMMITTED` | COMMIT received, escrow locked, awaiting fulfilment |
| `FULFILLED` | FULFIL received, escrow released, transaction complete |
| `DISPUTED` | DISPUTE raised, escrow frozen |

### 5.2 Valid Transitions

```
INTENT ──────────> QUOTED (via QUOTE)
QUOTED ──────────> COUNTERED (via COUNTER)
QUOTED ──────────> COMMITTED (via COMMIT)
COUNTERED ───────> COUNTERED (via COUNTER)
COUNTERED ───────> QUOTED (via QUOTE — revised offer)
COUNTERED ───────> COMMITTED (via COMMIT)
COMMITTED ───────> FULFILLED (via FULFIL)
COMMITTED ───────> DISPUTED (via DISPUTE)
```

### 5.3 Transition Diagram

```
                    ┌──────────┐
                    │  INTENT  │
                    └────┬─────┘
                         │ QUOTE
                         ▼
                    ┌──────────┐
            ┌──────│  QUOTED   │◀─────┐
            │      └──────────┘      │
            │ COUNTER           COMMIT│      QUOTE
            ▼                         │       │
       ┌──────────┐           ┌──────────┐   │
       │COUNTERED │──COMMIT──▶│COMMITTED │   │
       └────┬──┬──┘           └────┬─────┘   │
            │  │                   │         │
            │  └───────────────────┼─────────┘
            │ COUNTER              ├── FULFIL ──▶ ┌──────────┐
            └───┘                  │              │FULFILLED │
                                   │              └──────────┘
                                   │
                                   └── DISPUTE ─▶ ┌──────────┐
                                                  │DISPUTED  │
                                                  └──────────┘
```

### 5.4 Terminal States

- **FULFILLED** — Transaction completed successfully. Escrow released.
- **DISPUTED** — Escrow frozen. Resolution occurs out-of-band in v0.1 (future versions will define on-chain arbitration).

---

## 6. Error Codes

| Code | Name | Description |
|---|---|---|
| `BCP_001` | Invalid Signature | Ed25519 signature verification failed |
| `BCP_002` | Expired Message | Message timestamp + TTL has elapsed, or validity_until has passed |
| `BCP_003` | Invalid State Transition | Message type is not valid for the current session state |
| `BCP_004` | Insufficient Escrow | Escrow amount does not match committed offer price |
| `BCP_005` | Unknown Reference | Referenced intent_id, quote_id, counter_id, or commit_id not found |

Error response format:

```json
{
  "error": {
    "code": "BCP_003",
    "message": "Cannot send FULFIL in state QUOTED — expected COMMITTED",
    "details": {
      "current_state": "QUOTED",
      "attempted_transition": "FULFIL"
    }
  }
}
```

---

## 7. Payment Terms Module

### 7.1 Payment Terms to Escrow Behaviour Mapping

| Payment Term | Escrow Lock | x402 Call Trigger | Due Date Calculation |
|---|---|---|---|
| `immediate` | Full amount on COMMIT | On COMMIT acceptance | Same as commit timestamp |
| `net15` | Full amount on COMMIT | 15 days after FULFIL confirmed | FULFIL timestamp + 15 days |
| `net30` | Full amount on COMMIT | 30 days after FULFIL confirmed | FULFIL timestamp + 30 days |
| `net45` | Full amount on COMMIT | 45 days after FULFIL confirmed | FULFIL timestamp + 45 days |
| `net60` | Full amount on COMMIT | 60 days after FULFIL confirmed | FULFIL timestamp + 60 days |
| `net90` | Full amount on COMMIT | 90 days after FULFIL confirmed | FULFIL timestamp + 90 days |

### 7.2 Immediate Terms Flow

1. Buyer sends COMMIT with `escrow.payment_schedule.type = "immediate"`.
2. Escrow locks the full amount.
3. x402 payment is triggered immediately — the buyer's agent sends a payment proof header to the seller's x402-enabled endpoint.
4. On 200 response, escrow is released.

### 7.3 Net-N Terms Flow

1. Buyer sends COMMIT with `escrow.payment_schedule.type = "net30"` (for example).
2. Escrow locks the full amount.
3. Seller sends FULFIL confirming delivery.
4. A scheduled job fires the x402 call 30 days after the FULFIL timestamp.
5. On 200 response, escrow is released.

### 7.4 Early Payment Discount

A QUOTE or COUNTER may include an `early_pay_discount` object:

```json
{
  "early_pay_discount": {
    "discount_percent": 2.0,
    "if_paid_within_days": 10
  }
}
```

This encodes "2/10 net 30" — a 2% discount if payment is made within 10 days of fulfilment. The buyer agent MAY elect to trigger early x402 payment to capture the discount. The settlement amount is reduced by the discount percentage if the payment timestamp falls within the discount window.

---

## 8. Security Considerations

1. **All messages MUST be transmitted over HTTPS.** Plaintext HTTP MUST NOT be used.
2. **Signature verification is mandatory.** Any message with an invalid or missing signature MUST be rejected with `BCP_001`.
3. **Replay protection** — Receivers SHOULD track processed message IDs and reject duplicates.
4. **Timestamp validation** — Receivers SHOULD reject messages with timestamps more than 5 minutes in the future or past the TTL/validity window.
5. **Credential verification** — In production, agent credentials SHOULD be verified against a trust registry or on-chain identity contract.

---

## 9. Future Work (Post v0.1)

- On-chain dispute arbitration protocol
- Partial fulfilment and milestone-based escrow release
- Agent credential registry standard
- Rate limiting and DDoS protection recommendations
- Webhook subscriptions for state change notifications

---

## 10. Multi-Seller RFQ

BCP supports broadcasting an INTENT to multiple sellers simultaneously via the Request for Quotes (RFQ) pattern. This allows a buyer agent to solicit competing offers, compare them objectively, and commit to the best one — all in a single coordinated flow.

### 10.1 RFQ Protocol Extension

A new optional field `rfq_id` (UUID v4) is added to the INTENT message:

| Field | Type | Required | Description |
|---|---|---|---|
| `rfq_id` | string (UUID v4) | ❌ | Identifier for the multi-seller RFQ broadcast. When present, signals that this INTENT is one of several parallel solicitations sharing the same procurement event. |

A single `rfq_id` is shared across all INTENT messages sent to different sellers in a single broadcast. Each INTENT still carries its own unique `intent_id`.

### 10.2 RFQ Flow

```
Buyer
  │
  ├── INTENT (rfq_id=X, intent_id=A) ──▶ Seller A  ──▶ QUOTE (price=$10)
  ├── INTENT (rfq_id=X, intent_id=B) ──▶ Seller B  ──▶ QUOTE (price=$8)
  └── INTENT (rfq_id=X, intent_id=C) ──▶ Seller C  ──▶ QUOTE (price=$9)
  │
  │  [collect, verify, sort by price ascending]
  │
  └── COMMIT (accepted_ref_id=quote_B) ──▶ Seller B  ──▶ FULFIL
```

1. **BROADCAST** — Buyer sends one INTENT per seller in parallel. All share the same `rfq_id`. Each uses a unique `intent_id`.
2. **COLLECT** — Buyer waits up to `timeoutMs` for QUOTE responses. Sellers that do not respond in time are recorded in `timedOut`.
3. **VERIFY** — Each received QUOTE is signature-verified using the seller's declared `credential` (Ed25519 public key) before being accepted as a valid offer.
4. **RANK** — All verified quotes are sorted by `offer.price` ascending (cheapest first).
5. **COMMIT** — Buyer selects a quote (typically the cheapest) and sends a COMMIT directly to that seller, reusing the `intent_id` from the RFQ broadcast. Escrow is locked on-chain before the COMMIT message is sent.
6. **ABANDON** — Sessions with non-selected sellers remain in the `QUOTED` state and naturally expire via their `validity_until` timestamps. No explicit ABANDON message is defined in v0.1.

### 10.3 State Machine Extension

```
BROADCAST ──▶ multiple INTENT sessions created (one per seller)
               each session: INITIATED ──▶ QUOTED

One session: QUOTED ──▶ COMMITTED ──▶ FULFILLED
All others:  QUOTED ──▶ (abandoned — session expires at validity_until)
```

### 10.4 Implementation Notes

- The buyer MUST verify each QUOTE signature before including it in the ranked results.
- Sellers receiving an INTENT with `rfq_id` SHOULD respond as normal. The field is informational only; no behavioral change is required of the seller.
- The buyer SHOULD use `Promise.allSettled` (or equivalent) for parallel solicitation so that a slow or unresponsive seller does not block the entire RFQ.
- Quotes received after `timeoutMs` MUST be discarded.
- The `commit()` helper on `RFQResult` automatically commits to the lowest-price verified quote.
- The `commitTo(quote)` helper allows the buyer to select a different quote from the ranked list (e.g. preferred supplier, better delivery terms).
