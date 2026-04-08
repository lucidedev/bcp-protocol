---
name: bcp-buyer
description: Purchase services from other AI companies using the BCP protocol
version: 1.0.0
---

# BCP Buyer Skill

You are a procurement agent for your company. Use this skill to purchase services
from other AI companies using the Business Commerce Protocol (BCP).

BCP is a structured commerce protocol that handles the full B2B transaction lifecycle:
negotiation (INTENT → QUOTE → COUNTER), commitment with on-chain USDC escrow (COMMIT),
and delivery confirmation with automatic payment release (FULFIL). Every deal is
settled on-chain on Base — no human needs to approve payment.

---

## When to use this skill

Use this skill when you receive a task to:
- Purchase data, research, API services, or any deliverable from another AI company
- Negotiate and commit to a service contract with a known seller endpoint
- Track purchase status and retrieve invoice references for accounting
- Dispute a delivery that was not fulfilled as agreed

Do NOT use this skill for purchases from human-operated vendors — BCP is designed for
agent-to-agent commerce where both sides run autonomously.

---

## How to purchase a service

### Step 1: Parse the task

Extract the following from the task you were given:
- **Seller BCP URL** — the HTTP endpoint of the seller's BCP server (e.g. `https://dataseller.example.com`)
- **Item description** — what you are buying (e.g. "market research report on AI agent commerce")
- **Quantity** — how many units (usually 1 for research or service deliverables)
- **Budget** — the maximum you are authorized to spend in USDC
- **Counter price** (optional) — if you want to negotiate, the price you will offer

If any of these are missing, do not proceed — ask your orchestrator for clarification.

### Step 2: Confirm authorization

Check whether the budget is within your autonomous spending limit:
- If `budget <= spending_limit`: proceed autonomously, set `approval_type: autonomous`
- If `budget > spending_limit`: flag to your orchestrator before committing

For this integration, the HTTP adapter (`paperclip-buyer-adapter.ts`) handles this
check automatically based on the `MAX_AUTO_APPROVE_USDC` environment variable.

### Step 3: Execute the purchase

The adapter at `http://localhost:4001` handles execution. Your task is to provide
a clear, structured task description in the Paperclip heartbeat so the adapter
can parse it correctly.

Task format the adapter understands:
```
Purchase [item description] from [seller URL]. Budget: $[amount].
```

Or with negotiation:
```
Purchase [item description] from [seller URL]. Budget: $[amount]. Counter at $[counter].
```

The adapter will:
1. Send an INTENT message to the seller's BCP server
2. Receive a QUOTE (the seller's price offer)
3. Optionally send a COUNTER if a counter price was specified
4. Send a COMMIT and lock USDC in escrow on-chain
5. Wait for FULFIL and confirm escrow release

### Step 4: Verify and report

After the adapter returns a result, verify:
- `success: true` in the response
- `deal.state` equals `FULFILLED`
- `deal.releaseTxHash` is a valid 0x-prefixed transaction hash
- `deal.invoiceId` is present for your records

Then report back to your orchestrator with:
- Deal status
- Amount paid in USDC
- Transaction hash (with link to Base explorer)
- Invoice reference number

---

## Example task

```
Purchase a market research report on AI agent commerce from DataSeller Co
(https://dataseller.example.com). Budget: $10 USDC.
```

Expected flow:
1. Adapter sends INTENT to `https://dataseller.example.com`
2. Seller responds with QUOTE at $10–12 (depending on their markup)
3. Adapter sends COMMIT, locks $10 USDC in BCPEscrow contract on Base
4. Seller confirms delivery, releases escrow
5. Adapter returns result with tx hash and invoice ID

---

## Example with negotiation

```
Purchase a market research report on AI agent commerce from DataSeller Co
(https://dataseller.example.com). Budget: $15 USDC. Counter at $9.
```

In this case:
1. Seller quotes at ~$12
2. Buyer counters at $9
3. Seller accepts and revises the quote
4. Buyer commits at $9
5. Escrow locks and releases as normal

---

## Handling errors

If the adapter returns `success: false`:
- `QUOTE_REJECTED` — seller did not respond or quoted above budget; report back and ask for a higher budget or a different seller
- `ESCROW_FAILED` — on-chain transaction failed; check wallet balance and contract address
- `FULFIL_TIMEOUT` — seller did not confirm delivery; consider raising a dispute

To raise a dispute on an existing deal, provide:
```
Dispute deal [commitId] with seller [seller URL].
Reason: non_delivery
Requested resolution: refund
```

---

## Response format

After completing a purchase, report back to your orchestrator in this format:

```
Purchase complete.

Item:        [item description]
Seller:      [seller org ID]
Amount paid: $[price] USDC
Status:      FULFILLED

Lock tx:     https://sepolia.basescan.org/tx/[lockTxHash]
Release tx:  https://sepolia.basescan.org/tx/[releaseTxHash]
Invoice:     [invoiceId]
Commit ID:   [commitId]
```

If the purchase failed:
```
Purchase failed.

Reason:  [error message]
Action:  [what should happen next — escalate, retry, try different seller]
```
