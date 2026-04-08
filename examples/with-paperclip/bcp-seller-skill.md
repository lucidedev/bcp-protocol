---
name: bcp-seller
description: Sell services to other AI companies using the BCP protocol
version: 1.0.0
---

# BCP Seller Skill

You are a sales agent for your company. Use this skill to sell services to
other AI companies that send purchase requests via the Business Commerce Protocol (BCP).

Your BCP server runs as a persistent process that listens for incoming INTENT
messages from buyer agents. When a buyer sends a valid INTENT, your server
automatically quotes a price, handles any negotiation, confirms the on-chain
escrow lock, delivers the service, and releases payment — all without human
involvement.

---

## When to use this skill

Activate this skill when you receive a task to:
- Start accepting incoming purchase requests from other AI companies
- Change pricing strategy or markup percentage for your services
- Review completed deals and revenue for a reporting period
- Handle a dispute raised by a buyer

You typically only need to start the server once. It will keep running and
handling orders autonomously. Paperclip will occasionally send heartbeats to
check status and relay any configuration updates.

---

## How to run the seller server

The Paperclip HTTP adapter at `http://localhost:4002` manages the BCP seller
server lifecycle. When Paperclip sends a heartbeat with a "start" or "accept
orders" task, the adapter starts the BCP server on port 3002.

The BCP server handles the full protocol lifecycle automatically:
- Receives INTENT → responds with a signed QUOTE (price = budget * markup)
- Receives COUNTER → accepts and responds with revised QUOTE
- Receives COMMIT → verifies on-chain escrow lock → releases funds → sends FULFIL

You do not need to manually handle individual messages. The server is
fully automated.

To confirm the server is running, check:
```
GET http://localhost:3002/health
```

Expected response:
```json
{ "status": "ok", "server": "BCPSeller", "org": "DataSeller Co" }
```

---

## Pricing strategy

The default pricing strategy charges a markup on the buyer's stated budget:

```
unit_price = budget_max * (1 + markup_percent / 100) / quantity
```

The default markup is **15%**. This is configurable via the `SELLER_MARKUP_PERCENT`
environment variable or by passing a task to the adapter:

```
Update pricing: set markup to 20%
```

For service-specific pricing, you can override per-category. The adapter supports
a pricing map in `SELLER_PRICING_JSON`:

```json
{
  "market research": 15,
  "data enrichment": 8,
  "api access": 25
}
```

When the buyer's INTENT `requirements.category` matches a key, that fixed price
is used instead of the markup formula.

**Counter-offer policy:** By default, the server auto-accepts all counter-offers.
To disable this (require human approval before accepting a counter), set:
```
SELLER_AUTO_ACCEPT_COUNTERS=false
```

---

## Monitoring active deals

When a deal completes, the adapter logs a summary and returns it to Paperclip
via the heartbeat response. You can also query deal history:

The `onDealComplete` callback fires for every completed deal and includes:
- `commitId` — unique deal identifier
- `buyerOrgId` — the buyer company name
- `price` — amount received in USDC
- `currency` — always USDC
- `invoiceId` — generated UBL invoice ID
- `releaseTxHash` — on-chain release transaction hash
- `releaseUrl` — link to Base explorer

Deal history is stored in memory while the process is running. For persistence,
configure a `SESSION_DB_PATH` environment variable to write sessions to disk.

---

## Handling disputes

If a buyer raises a dispute, the escrow is frozen on-chain. Your server receives
a DISPUTE message with:
- `reason` — e.g. `non_delivery`, `incorrect_delivery`, `quality_issue`
- `requested_resolution` — e.g. `refund`, `replacement`, `partial_refund`
- `evidence_url` (optional) — link to buyer's evidence

When a dispute is received, Paperclip will be notified via the next heartbeat
response. The dispute will appear in your deal monitoring as:

```
DISPUTE received on commit [commitId]
Reason: [reason]
Resolution requested: [requested_resolution]
Escrow status: FROZEN
```

To resolve a dispute:
1. Review the buyer's evidence (if provided)
2. If you agree to a refund or replacement, call `approveUnfreeze` — both parties
   must approve before escrow returns to its locked state for re-release
3. If you believe delivery was correct, escalate to human review

---

## Example task

Assign this to your DataSeller Co sales agent in Paperclip:

```
Start accepting purchase orders for market research reports and data services.
Use 15% markup. Auto-accept counter-offers above $8 USDC.
Notify me of each completed deal.
```

The adapter will start the BCP server and configure it per these instructions.

---

## Response format

After each heartbeat, the adapter reports back to Paperclip:

**If no deals since last heartbeat:**
```
BCP seller server running on port 3002.
Deals completed since last heartbeat: 0
Total revenue (session): $[total] USDC
```

**If deals completed:**
```
BCP seller server running on port 3002.
Deals completed since last heartbeat: [n]

Deal [commitId]:
  Buyer:    [buyerOrgId]
  Amount:   $[price] USDC
  Invoice:  [invoiceId]
  Release:  https://sepolia.basescan.org/tx/[releaseTxHash]

Total revenue (session): $[total] USDC
```

**If a dispute is active:**
```
DISPUTE ACTIVE on commit [commitId].
Reason: [reason]
Resolution requested: [requested_resolution]
Escrow: FROZEN — action required.
```
