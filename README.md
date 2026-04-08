# BCP — Business Commerce Protocol

[![CI](https://github.com/lucidedev/bcp-protocol/actions/workflows/ci.yml/badge.svg)](https://github.com/lucidedev/bcp-protocol/actions/workflows/ci.yml)

**An open source B2B agent commerce protocol built on top of x402.**

BCP defines the structured commerce conversation between two AI agents — negotiation, commitment, fulfilment, and dispute — before and around payment. Settlement flows through [x402](https://www.x402.org/), Coinbase's open protocol for stablecoin payments over HTTP using the `402 Payment Required` status code. BCP never replaces or forks x402.

**Version:** 0.1 (Draft)  
**License:** Apache 2.0

---

## Quick Start (< 5 minutes)

```bash
git clone https://github.com/lucidedev/bcp-protocol.git
cd bcp-protocol
npm install
cp .env.example .env    # fill in wallet keys
```

### Two-terminal demo (the real way)

This is how BCP works in production — buyer and seller run as **separate processes**.

**Terminal 1 — Seller:**
```bash
npm run seller
```

**Terminal 2 — Buyer:**
```bash
npm run buyer
```

Two processes. Two companies. One blockchain transaction. Verify the tx hashes on [Base Sepolia Explorer](https://sepolia.basescan.org).

### Single-process demo (quick test)

```bash
npm run demo:sdk
```

Runs buyer + seller in one process for quick verification. Works, but doesn't demonstrate the real architecture.

### Interactive UI demo

```bash
cd demo
npm install
npm run dev
```

Opens a visual step-by-step demo at `http://localhost:3000` with real on-chain USDC transactions, animated message flow, x402 payment panel, and tx hash links to BaseScan.

---

## Message Types

| Type | Sender | Purpose |
|---|---|---|
| `INTENT` | Buyer | Declare a procurement need |
| `QUOTE` | Seller | Respond with a signed offer |
| `COUNTER` | Either | Propose modified terms |
| `COMMIT` | Buyer | Accept offer, lock escrow |
| `FULFIL` | Seller | Confirm delivery, trigger settlement |
| `DISPUTE` | Either | Freeze escrow, raise issue |

---

## State Machine

```
                    ┌──────────┐
                    │  INTENT  │
                    └────┬─────┘
                         │ QUOTE
                         ▼
                    ┌──────────┐
            ┌──────│  QUOTED   │──────┐
            │      └──────────┘      │
            │ COUNTER           COMMIT│
            ▼                         ▼
       ┌──────────┐           ┌──────────┐
       │COUNTERED │──COMMIT──▶│COMMITTED │
       └────┬─────┘           └────┬─────┘
            │                      │
            │ COUNTER              ├── FULFIL ──▶ FULFILLED
            └───┘                  │
                                   └── DISPUTE ─▶ DISPUTED
```

**Valid transitions:**

```
INTENT    → QUOTED     (via QUOTE)
QUOTED    → COUNTERED  (via COUNTER)
QUOTED    → COMMITTED  (via COMMIT)
COUNTERED → COUNTERED  (via COUNTER)
COUNTERED → QUOTED     (via QUOTE — revised offer)
COUNTERED → COMMITTED  (via COMMIT)
COMMITTED → FULFILLED  (via FULFIL)
COMMITTED → DISPUTED   (via DISPUTE)
```

---

## Architecture

```
/bcp
  /spec
    SPEC.md                    ← Full protocol specification
    /schemas                   ← JSON Schema for each message type
  /src
    /messages                  ← TypeScript interfaces for all message types
    /validation
      validator.ts             ← JSON Schema validation (ajv)
      signature.ts             ← Ed25519 sign/verify (@noble/ed25519)
    /state
      session.ts               ← State machine, SessionStore interface
    /escrow
      escrow.ts                ← Escrow provider interface
      onchain-escrow.ts        ← On-chain escrow (BCPEscrow contract)
    /settlement
      x402-bridge.ts           ← x402 payment bridge
    /invoice
      ubl-generator.ts         ← UBL 2.1 invoice XML generator
    /transport
      server.ts                ← Express BCP server (seller-side)
      client.ts                ← HTTP BCP client (buyer-side)
    buyer.ts                   ← BCPBuyer SDK (buyer process)
    seller.ts                  ← BCPSeller SDK (seller process)
    sdk.ts                     ← BCP single-process SDK (testing/demos)
    index.ts                   ← Public API exports
  /examples
    seller-server.ts           ← Seller agent (Terminal 1)
    buyer-client.ts            ← Buyer agent (Terminal 2)
    demo-sdk.ts                ← Single-process SDK demo
    demo-live.ts               ← Verbose step-by-step demo
  /contracts
    BCPEscrow.sol              ← Permissionless escrow (ETH + ERC-20)
  /demo
    app/                       ← Next.js interactive demo UI
  /tests
    messages.test.ts           ← Message validation tests
    state-machine.test.ts      ← State transition tests
    signature.test.ts          ← Ed25519 signature tests
```

### SDK Architecture

```
┌──── Buyer Process ────┐          ┌──── Seller Process ────┐
│                       │          │                        │
│  BCPBuyer             │   HTTP   │  BCPSeller             │
│  ├─ BCPClient ────────┼──────────┼─▶ BCPServer            │
│  ├─ OnChainEscrow     │          │  ├─ SessionManager     │
│  └─ Ed25519 signer    │          │  ├─ OnChainEscrow      │
│                       │          │  └─ UBL invoicing      │
└───────────────────────┘          └────────────────────────┘
         │                                    │
         └──────── Base Sepolia ──────────────┘
                   (USDC + BCPEscrow)
```

The buyer never has the seller's private key. The seller never has the buyer's private key. They communicate over HTTP and settle on-chain.

---

## How It Relates to x402

| Layer | Protocol | Responsibility |
|---|---|---|
| Commerce | **BCP** | Negotiation, commitment, fulfilment, dispute |
| Payment | **x402** | Stablecoin payment execution over HTTP 402 |

BCP determines *what* to pay, *when* to pay, and *under what conditions*. x402 executes the actual payment. BCP's `COMMIT` message locks escrow, and on `FULFIL`, the x402 bridge triggers settlement.

For `immediate` terms, x402 fires on COMMIT. For `net_N` terms, x402 fires N days after FULFIL.

---

## Running Tests

```bash
npm install
npm test
```

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -am 'Add my feature'`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

Please ensure all tests pass and follow TypeScript strict mode conventions.

---

## Production Notes

The reference implementation includes a fully on-chain escrow provider (`OnChainEscrowProvider`) and a live x402 settlement bridge. For production deployment:

- **Escrow**: `OnChainEscrowProvider` interacts with the `BCPEscrow` Solidity contract on Base Sepolia. Deploy to mainnet and configure the contract address.
- **Settlement**: `X402Bridge` executes the full HTTP 402 challenge-response flow with EIP-191 signed payment proofs. Configure with the buyer's EVM private key.
- **Sessions**: Implement `SessionStore` for persistent session storage (Redis, Postgres, etc.). The default `InMemorySessionStore` loses state on restart.
  ```ts
  import { SessionStore, SessionManager } from 'bcp-protocol';
  
  class RedisSessionStore implements SessionStore {
    get(intentId: string) { /* redis.get(`bcp:${intentId}`) */ }
    save(session: Session) { /* redis.set(`bcp:${session.intentId}`, ...) */ }
    // ...
  }
  
  const manager = new SessionManager(new RedisSessionStore());
  ```
- **Identity**: Replace credential strings with verifiable credentials resolved from an on-chain identity registry.
- **Logging**: Configure the structured logger with a production transport: `configureLogger({ level: LogLevel.WARN, transport: yourTransport })`.

---

## License

```
Copyright 2026 BCP Contributors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```
