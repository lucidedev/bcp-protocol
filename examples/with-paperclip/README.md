# BCP + Paperclip: Autonomous Agent-to-Agent Commerce

> **Paperclip gives AI agents a company. BCP gives those companies the ability to trade with each other.**

This example shows two Paperclip companies — **BuyerCorp** and **DataSeller Co** — conducting a fully autonomous B2B transaction over the Business Commerce Protocol. No humans approve invoices. No humans move money. The agents negotiate, commit, escrow USDC on-chain, and release payment automatically.

---

## The Concept

[Paperclip](https://paperclip.ing) is a multi-agent orchestration framework for "zero-human companies." Each company is a collection of AI agents with roles, tools, and access to a shared wallet. Agents can be given HTTP adapters: Paperclip periodically POSTs a heartbeat payload to the adapter endpoint, the adapter does work, and returns a result.

BCP (Business Commerce Protocol) defines the structured commerce conversation between two AI agents: INTENT → QUOTE → (COUNTER) → COMMIT → FULFIL. Settlement flows through on-chain USDC escrow on Base.

Together:

- A Paperclip **buyer agent** receives a procurement task via heartbeat, spins up a BCP buyer, negotiates with a remote seller, locks USDC in escrow, and returns a confirmed deal to Paperclip.
- A Paperclip **seller agent** runs a persistent BCP server as its HTTP adapter. When Paperclip delivers a task like "accept incoming purchase requests," the adapter handles the BCP protocol lifecycle and releases escrow when delivery is confirmed.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         BuyerCorp                                │
│   (Paperclip company)                                            │
│                                                                  │
│   Paperclip Orchestrator                                         │
│        │  POST /heartbeat  (task: "purchase market research")   │
│        ▼                                                         │
│   paperclip-buyer-adapter.ts  :4001                              │
│        │  BCPBuyer.purchase()                                    │
└────────┼─────────────────────────────────────────────────────────┘
         │
         │  HTTP (BCP Protocol)
         │  INTENT → QUOTE → COMMIT → FULFIL
         │
         │  On-chain: USDC locked in BCPEscrow (Base)
         │
┌────────┼─────────────────────────────────────────────────────────┐
│        ▼                         DataSeller Co                   │
│   paperclip-seller-adapter.ts  :4002                             │
│   (BCP server embedded inside Paperclip HTTP adapter)            │
│                                                                  │
│   Paperclip Orchestrator                                         │
│        │  POST /heartbeat  (task: "start accepting orders")      │
│        ▼                                                         │
│   BCPSeller.listen()  :3002                                      │
└──────────────────────────────────────────────────────────────────┘
```

**What makes this special:** Both companies are fully autonomous. BuyerCorp's agent decides what to buy and at what price. DataSeller Co's agent decides what to charge and when to release escrow. Paperclip handles orchestration, scheduling, and company state. BCP handles the commerce protocol and money movement. Neither company employs a human in the loop.

---

## Prerequisites

- **Node.js 20+**
- **Paperclip installed and onboarded:**
  ```bash
  npx paperclipai onboard --yes
  ```
- **Two funded wallets on Base Sepolia** (one per company). Get test USDC from the [Coinbase faucet](https://faucet.coinbase.com/).
- **Deployed BCPEscrow contract** — see the root README for deployment instructions.
- Environment variables set (see `.env` setup below).

---

## Environment Setup

Create two `.env` files, one per company:

**`.env.buyer`** (BuyerCorp):
```env
# Buyer's EVM wallet (must hold USDC)
BUYER_EVM_PRIVATE_KEY=0x...

# Seller's EVM address (so the buyer knows where to route escrow)
SELLER_EVM_ADDRESS=0x...

# Deployed BCPEscrow contract on Base Sepolia
BCP_ESCROW_CONTRACT_ADDRESS=0x...

# BCP seller endpoint (DataSeller Co's BCP server)
SELLER_BCP_URL=http://localhost:3002

# Buyer's Ed25519 signing keys (auto-generated if blank)
BUYER_ED25519_PRIVATE_KEY=
BUYER_ED25519_PUBLIC_KEY=
```

**`.env.seller`** (DataSeller Co):
```env
# Seller's EVM wallet (receives USDC on release)
SELLER_EVM_PRIVATE_KEY=0x...

# Buyer's EVM address (so the seller can verify escrow counterparty)
BUYER_EVM_ADDRESS=0x...

# Deployed BCPEscrow contract on Base Sepolia
BCP_ESCROW_CONTRACT_ADDRESS=0x...

# Seller's Ed25519 signing keys (auto-generated if blank)
SELLER_ED25519_PRIVATE_KEY=
SELLER_ED25519_PUBLIC_KEY=
```

---

## Step-by-Step Setup

### Step 1: Install dependencies

```bash
cd /path/to/bcp
npm install
```

### Step 2: Start the DataSeller Co adapter

In a dedicated terminal:
```bash
npx ts-node examples/with-paperclip/paperclip-seller-adapter.ts
```

This starts two servers:
- **Port 3002** — the BCP seller server (handles INTENT, COUNTER, COMMIT)
- **Port 4002** — the Paperclip HTTP adapter (Paperclip posts heartbeats here)

### Step 3: Start the BuyerCorp adapter

In a second terminal:
```bash
npx ts-node examples/with-paperclip/paperclip-buyer-adapter.ts
```

This starts one server:
- **Port 4001** — the Paperclip HTTP adapter (Paperclip posts heartbeats here)

### Step 4: Create two Paperclip companies

In the Paperclip dashboard (or via CLI), create:

1. **BuyerCorp** — set HTTP adapter URL to `http://localhost:4001/heartbeat`
2. **DataSeller Co** — set HTTP adapter URL to `http://localhost:4002/heartbeat`

Add the relevant skill files to each agent:
- Give BuyerCorp's procurement agent the `bcp-buyer-skill.md` skill
- Give DataSeller Co's sales agent the `bcp-seller-skill.md` skill

### Step 5: Assign a task to BuyerCorp

In Paperclip, assign the following task to BuyerCorp's procurement agent:

```
Purchase a market research report on AI agent commerce from DataSeller Co
at http://localhost:3002. Budget: $10 USDC.
```

Paperclip will POST this task to `http://localhost:4001/heartbeat`. The adapter parses it, calls `BCPBuyer.purchase()`, and the full BCP protocol runs automatically.

### Step 6: Watch the deal complete

You will see in the terminals:
1. Buyer adapter receives the heartbeat
2. INTENT sent to DataSeller Co's BCP server
3. QUOTE returned (with markup)
4. COMMIT sent + USDC locked in escrow on-chain
5. FULFIL received + escrow released
6. Buyer adapter returns deal result to Paperclip

---

## Running the Full Demo Automatically

```bash
bash examples/with-paperclip/demo-two-companies.sh
```

This script starts both adapters and prints instructions for the Paperclip side.

---

## What to Expect

After a successful run, both terminals show:

**Seller terminal:**
```
← INTENT received, sending QUOTE  { buyer: 'BuyerCorp', price: 11.5 }
← COMMIT received, releasing escrow  { commitId: '...', amount: 10 }
✓ ESCROW RELEASED  { tx: '0x...' }
Deal complete: $10 USDC  INV-1234567890
```

**Buyer terminal:**
```
Paperclip heartbeat received  { task: 'Purchase market research...' }
→ INTENT  { item: 'AI agent commerce market research' }
← QUOTE received  { price: 11.5 }
→ COMMIT + escrow lock  { amount: 10 }
← FULFIL received  { releaseTx: '0x...' }
Returning result to Paperclip: Purchase completed. $10 USDC. Tx: 0x...
```

Verify both transactions on [Base Sepolia Explorer](https://sepolia.basescan.org).

---

## Skills Reference

| File | Purpose |
|---|---|
| `bcp-buyer-skill.md` | Teaches a Paperclip buyer agent how to use BCP to purchase services |
| `bcp-seller-skill.md` | Teaches a Paperclip seller agent how to run a BCP server and handle orders |

Add these as skill files to the relevant agents in your Paperclip companies.

---

## Further Reading

- [BCP Protocol Spec](../../spec/) — full message type definitions
- [BCP Root README](../../README.md) — quick start and architecture overview
- [Paperclip Docs](https://paperclip.ing/docs) — HTTP adapter setup, OpenClaw invite flow
- [x402 Protocol](https://www.x402.org/) — the settlement layer BCP builds on
- [Base Sepolia Explorer](https://sepolia.basescan.org) — verify your on-chain transactions
