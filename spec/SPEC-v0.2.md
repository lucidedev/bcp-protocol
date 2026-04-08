# BCP — Business Commerce Protocol Specification

**Version:** 0.2  
**Status:** Draft  
**Date:** 2026-04-08  
**License:** Apache 2.0  
**Supersedes:** v0.1

---

## 1. Overview

The Business Commerce Protocol (BCP) defines structured commerce conversations between two AI agents representing organizations. One agent acts as **buyer**, the other as **seller**. BCP provides the negotiation lifecycle — from intent to fulfilment — as a minimal, transport-agnostic state machine.

### 1.1 Design Principles

1. **Minimal by default** — Messages carry only the fields needed by the state machine. Everything else is optional.
2. **Agent-first** — Every message is created and consumed by AI agents operating on behalf of organizations.
3. **Transport-agnostic** — BCP works over synchronous HTTP request-response, async webhooks, message queues, or platform-internal calls.
4. **Pluggable security** — Authentication can be delegated to the transport layer (`platform`), handled via Ed25519 signatures (`ed25519`), or omitted for development (`none`).
5. **Pluggable settlement** — Parties agree on how payment works: `none`, `invoice`, `x402`, or `escrow`. Settlement is not baked into the protocol.
6. **Deterministic state machine** — Valid message transitions are strictly defined. Invalid transitions are rejected.

### 1.2 What changed from v0.1

| v0.1 | v0.2 | Rationale |
|------|------|-----------|
| 29-field INTENT message | 6-field INTENT | Real integrations used ~3 fields |
| Separate endpoint per message type | Single endpoint, routed by `type` field | Simpler for webhooks and platforms |
| Ed25519 signatures mandatory | Auth mode: `none` / `platform` / `ed25519` | Platforms already authenticate agents |
| On-chain escrow required on COMMIT | Settlement profile: `none` / `invoice` / `x402` / `escrow` | Most B2B AI deals don't need escrow |
| UBL 2.1 invoice required on FULFIL | Optional deliverables + summary | AI service deliveries aren't line-item goods |
| Synchronous HTTP only | `callbackUrl` for async responses | Real platforms use webhooks |
| `bcp_version: "0.1"` | `bcp_version: "0.2"` | — |

---

## 2. Transport

BCP messages are JSON objects. The protocol is transport-agnostic.

### 2.1 HTTP Transport (reference)

- **Endpoint:** `POST /bcp` (single endpoint)
- **Content-Type:** `application/json`
- **Routing:** The `type` field in the message body determines the handler.

**Response:** The receiver MAY return a BCP message directly in the HTTP response body (synchronous mode), or return `202 Accepted` and deliver the response asynchronously to the `callbackUrl`.

### 2.2 Async Transport

Any message MAY include a `callbackUrl` field. When present, the receiver SHOULD deliver response messages to that URL via `POST`.

```json
{ "type": "intent", "sessionId": "abc", "callbackUrl": "https://buyer.example.com/bcp", ... }
```

### 2.3 Platform Transport

When both agents run on the same platform (e.g. Paperclip, CrewAI), the platform MAY route messages internally without HTTP. The `type` and `sessionId` fields are still required.

---

## 3. Authentication

Authentication is declared per-session via the `auth` field on the INTENT message. Both parties MUST use the same auth mode for the duration of a session.

| Mode | Description |
|------|-------------|
| `none` | No authentication. For development and trusted environments only. |
| `platform` | Authentication delegated to the transport layer. The platform guarantees sender identity. |
| `ed25519` | Each message carries a `signature` field — an Ed25519 hex signature over the canonical JSON payload (excluding the `signature` field). |

When `auth` is `ed25519`, the signing and verification procedure from BCP v0.1 §3 applies.

When `auth` is omitted, it defaults to `none`.

---

## 4. Message Types

All messages share a common envelope:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `bcp_version` | string | ✅ | `"0.2"` |
| `type` | string | ✅ | Message type: `intent`, `quote`, `counter`, `commit`, `fulfil`, `dispute` |
| `sessionId` | string | ✅ | Unique session identifier. Set by the buyer in INTENT, reused by all subsequent messages. |
| `timestamp` | string | ✅ | ISO 8601 creation timestamp |
| `callbackUrl` | string | ❌ | URL for async response delivery |
| `auth` | string | ❌ | Auth mode (on INTENT only): `none`, `platform`, `ed25519` |
| `signature` | string | ❌ | Ed25519 hex signature (required when `auth` is `ed25519`) |

### 4.1 INTENT

Buyer declares what they need.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `service` | string | ✅ | What the buyer needs, in natural language |
| `budget` | number | ❌ | Maximum budget |
| `currency` | string | ❌ | Currency code (default: `"USD"`) |
| `rfqId` | string | ❌ | Shared ID for multi-seller RFQ broadcasts |

**Example:**
```json
{
  "bcp_version": "0.2",
  "type": "intent",
  "sessionId": "bcp_a1b2c3d4e5f6",
  "timestamp": "2026-04-08T12:00:00Z",
  "service": "Logo design for a fintech startup, modern minimalist style",
  "budget": 1000,
  "currency": "USD"
}
```

### 4.2 QUOTE

Seller responds with pricing.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `price` | number | ✅ | Offered price |
| `currency` | string | ✅ | Currency code |
| `deliverables` | string[] | ❌ | What the buyer will receive |
| `estimatedDays` | number | ❌ | Estimated delivery time in days |
| `validUntil` | string | ❌ | ISO 8601 quote expiry |
| `settlement` | string | ❌ | Proposed settlement: `none`, `invoice`, `x402`, `escrow` |

**Example:**
```json
{
  "bcp_version": "0.2",
  "type": "quote",
  "sessionId": "bcp_a1b2c3d4e5f6",
  "timestamp": "2026-04-08T12:01:00Z",
  "price": 500,
  "currency": "USD",
  "deliverables": ["3 logo concepts", "brand guidelines PDF", "source files"],
  "estimatedDays": 5,
  "settlement": "invoice"
}
```

### 4.3 COUNTER

Either party proposes different terms.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `counterPrice` | number | ✅ | Proposed price |
| `reason` | string | ❌ | Why the counter was made |

**Example:**
```json
{
  "bcp_version": "0.2",
  "type": "counter",
  "sessionId": "bcp_a1b2c3d4e5f6",
  "timestamp": "2026-04-08T12:02:00Z",
  "counterPrice": 350,
  "reason": "Budget is limited, can we reduce to 2 concepts?"
}
```

### 4.4 COMMIT

Buyer accepts the current price and hires the seller.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `agreedPrice` | number | ✅ | The price being committed to |
| `currency` | string | ✅ | Currency code |
| `settlement` | string | ❌ | Agreed settlement method (from QUOTE or negotiated) |
| `escrow` | object | ❌ | Escrow details, required only when `settlement` is `escrow` |
| `escrow.contractAddress` | string | ✅* | Escrow smart contract address |
| `escrow.txHash` | string | ❌ | Lock transaction hash |

*Required if `escrow` is present.

**Example (no escrow):**
```json
{
  "bcp_version": "0.2",
  "type": "commit",
  "sessionId": "bcp_a1b2c3d4e5f6",
  "timestamp": "2026-04-08T12:03:00Z",
  "agreedPrice": 400,
  "currency": "USD",
  "settlement": "invoice"
}
```

### 4.5 FULFIL

Seller confirms delivery.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `deliverables` | string[] | ❌ | What was delivered |
| `summary` | string | ❌ | Human/agent-readable summary of the work done |
| `proofHash` | string | ❌ | SHA-256 hash of delivery evidence |
| `invoiceUrl` | string | ❌ | URL to a formal invoice (any format) |

**Example:**
```json
{
  "bcp_version": "0.2",
  "type": "fulfil",
  "sessionId": "bcp_a1b2c3d4e5f6",
  "timestamp": "2026-04-08T14:00:00Z",
  "deliverables": ["logo-final.svg", "brand-guide.pdf", "figma-source.fig"],
  "summary": "Delivered 3 logo concepts with brand guidelines. Selected concept A refined to final.",
  "invoiceUrl": "https://seller.example.com/invoices/INV-2026-042"
}
```

### 4.6 DISPUTE

Either party flags a problem.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `reason` | string | ✅ | What went wrong |
| `resolution` | string | ❌ | Requested: `refund`, `redeliver`, `negotiate` |

**Example:**
```json
{
  "bcp_version": "0.2",
  "type": "dispute",
  "sessionId": "bcp_a1b2c3d4e5f6",
  "timestamp": "2026-04-08T15:00:00Z",
  "reason": "Logos are not minimalist as requested, they use heavy gradients",
  "resolution": "redeliver"
}
```

---

## 5. State Machine

The state machine is unchanged from v0.1.

### 5.1 States

| State | Description |
|-------|-------------|
| `initiated` | INTENT received, awaiting quotes |
| `quoted` | QUOTE received, awaiting counter or commit |
| `countered` | COUNTER received, awaiting revised quote, another counter, or commit |
| `committed` | COMMIT sent, work in progress |
| `fulfilled` | FULFIL received, deal complete |
| `disputed` | DISPUTE raised, deal paused |

### 5.2 Valid Transitions

```
intent  ────────> quoted     (via quote)
quoted  ────────> countered  (via counter)
quoted  ────────> committed  (via commit)
countered ──────> countered  (via counter)
countered ──────> quoted     (via quote — revised offer)
countered ──────> committed  (via commit)
committed ──────> fulfilled  (via fulfil)
committed ──────> disputed   (via dispute)
```

### 5.3 Terminal States

- **fulfilled** — Deal completed successfully.
- **disputed** — Deal paused. Resolution is out-of-band in v0.2 (platforms may define their own dispute resolution).

---

## 6. Settlement Profiles

Settlement is agreed during the QUOTE/COMMIT exchange. Both parties MUST agree on the same profile.

| Profile | Description | When to use |
|---------|-------------|-------------|
| `none` | No payment infrastructure. Trust-based or internal. | Development, testing, internal company agents |
| `invoice` | Seller sends an invoice URL in FULFIL. Payment is out-of-band. | Standard B2B — companies have invoicing. |
| `x402` | Payment via HTTP 402 protocol. Triggered on COMMIT or FULFIL. | Crypto-native agents with wallet support |
| `escrow` | Funds locked in smart contract on COMMIT, released on FULFIL. | High-value deals requiring trustless guarantees |

When `settlement` is omitted, it defaults to `none`.

The `escrow` profile follows the lock/release/freeze model from BCP v0.1 §7. The `BCPEscrow.sol` contract remains available for this profile.

---

## 7. Error Codes

| Code | Name | Description |
|------|------|-------------|
| `BCP_001` | Invalid Signature | Ed25519 signature verification failed |
| `BCP_002` | Expired | Message or quote has expired |
| `BCP_003` | Invalid State | Message type not valid for current session state |
| `BCP_004` | Price Mismatch | COMMIT price doesn't match last quoted price |
| `BCP_005` | Unknown Session | Session ID not found |

---

## 8. Multi-Seller RFQ

Same INTENT sent to multiple sellers with a shared `rfqId`. Each INTENT has a unique `sessionId`. Buyer collects quotes, selects the best, and sends COMMIT on that session.

```
Buyer
 ├── INTENT (rfqId=X, sessionId=A) ──▶ Seller A ──▶ QUOTE ($500)
 ├── INTENT (rfqId=X, sessionId=B) ──▶ Seller B ──▶ QUOTE ($400)
 └── INTENT (rfqId=X, sessionId=C) ──▶ Seller C ──▶ QUOTE ($450)
 │
 └── COMMIT on sessionId=B ──▶ Seller B ──▶ FULFIL
```

---

## 9. Security Considerations

1. **HTTPS** — HTTP transport SHOULD use TLS. Plaintext HTTP is acceptable only for local development.
2. **Auth mode enforcement** — When auth is `ed25519`, receivers MUST verify signatures and reject invalid ones.
3. **Replay protection** — Receivers SHOULD track processed session+timestamp pairs and reject duplicates.
4. **Spending limits** — Buyer implementations SHOULD enforce a maximum auto-approve amount before committing.
5. **Rate limiting** — Endpoints SHOULD implement rate limiting to prevent abuse.

---

## 10. Migration from v0.1

Implementations MAY support both `bcp_version: "0.1"` and `bcp_version: "0.2"` during the transition period. The `bcp_version` field determines which message schema to validate against.

Key mapping:
- v0.1 `message_type: "INTENT"` → v0.2 `type: "intent"`
- v0.1 `intent_id` → v0.2 `sessionId`
- v0.1 `buyer.spending_limit` → v0.2 `budget`
- v0.1 `requirements.category` → v0.2 `service`
- v0.1 `escrow` (required) → v0.2 `settlement: "escrow"` (optional)
- v0.1 `signature` (required) → v0.2 `signature` (only when `auth: "ed25519"`)
