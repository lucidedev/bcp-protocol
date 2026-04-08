#!/usr/bin/env npx ts-node
/**
 * Paperclip HTTP Adapter — BuyerCorp
 *
 * This server is BuyerCorp's Paperclip HTTP adapter. Paperclip will POST a
 * heartbeat payload to /heartbeat whenever it needs the agent to do work.
 * The adapter parses the task, executes a BCP purchase, and returns the result.
 *
 * Configure this URL in Paperclip:
 *   Agent HTTP adapter: http://localhost:4001/heartbeat
 *
 * Required environment variables (see .env.buyer):
 *   BUYER_EVM_PRIVATE_KEY       — buyer's EVM wallet private key
 *   SELLER_EVM_ADDRESS          — seller's EVM wallet address (for escrow)
 *   BCP_ESCROW_CONTRACT_ADDRESS — deployed BCPEscrow contract on Base
 *   SELLER_BCP_URL              — seller's BCP server URL (default: http://localhost:3002)
 *
 * Optional:
 *   MAX_AUTO_APPROVE_USDC       — spending limit for autonomous approval (default: 50)
 *   BCP_NETWORK                 — 'base-sepolia' or 'base' (default: 'base-sepolia')
 *   PORT                        — adapter listen port (default: 4001)
 */

import 'dotenv/config';
import express, { Request, Response } from 'express';
import { BCPBuyer } from '../../src/buyer';
import type { BuyerDealResult } from '../../src/buyer';

// ── Config ──────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT || 4001);
const NETWORK = process.env.BCP_NETWORK || 'base-sepolia';
const SELLER_BCP_URL = process.env.SELLER_BCP_URL || 'http://localhost:3002';
const MAX_AUTO_APPROVE = Number(process.env.MAX_AUTO_APPROVE_USDC || 50);

// ── Task parsing ─────────────────────────────────────────────────────────────

interface ParsedPurchaseTask {
  /** What to buy — passed as the item description in the INTENT message */
  description: string;
  /** Seller BCP server URL */
  sellerUrl: string;
  /** Maximum budget in USDC */
  budget: number;
  /** Optional counter-offer price */
  counterPrice?: number;
}

/**
 * Parse a natural-language purchase task from the Paperclip heartbeat context.
 *
 * Supported formats:
 *   "Purchase [item] from [url]. Budget: $[n]."
 *   "Purchase [item] from [url]. Budget: $[n]. Counter at $[n]."
 *   "Buy [item] from [url] for $[n]."
 *
 * Falls back to defaults for any field it cannot parse.
 */
function parsePurchaseTask(task: string): ParsedPurchaseTask {
  const lower = task.toLowerCase();

  // Extract seller URL — look for http:// or https://
  const urlMatch = task.match(/https?:\/\/[^\s,)]+/i);
  const sellerUrl = urlMatch ? urlMatch[0].replace(/\.$/, '') : SELLER_BCP_URL;

  // Extract budget — look for "$N", "budget: $N", "budget $N", "for $N"
  const budgetMatch = task.match(/(?:budget[:\s]+\$?|for\s+\$)([\d.]+)/i)
    || task.match(/\$\s*([\d.]+)/);
  const budget = budgetMatch ? parseFloat(budgetMatch[1]) : 10;

  // Extract counter price — "counter at $N" or "counter $N"
  const counterMatch = task.match(/counter(?:\s+at)?\s+\$?([\d.]+)/i);
  const counterPrice = counterMatch ? parseFloat(counterMatch[1]) : undefined;

  // Extract item description — text between "purchase"/"buy" and "from"
  const descMatch = task.match(/(?:purchase|buy)\s+(.+?)\s+from\s/i);
  const description = descMatch
    ? descMatch[1].trim()
    : task.substring(0, 80).trim(); // fallback: first 80 chars of task

  return { description, sellerUrl, budget, counterPrice };
}

// ── Adapter server ───────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

/**
 * Health check — Paperclip may ping this to verify the adapter is reachable.
 */
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', adapter: 'BCP Buyer', company: 'BuyerCorp' });
});

/**
 * Paperclip heartbeat endpoint.
 *
 * Paperclip POSTs this payload:
 * {
 *   runId:    string        — unique ID for this heartbeat run
 *   agentId:  string        — Paperclip agent identifier
 *   context:  {
 *     task:   string        — the task assigned to the agent
 *     skills: string[]      — active skill names
 *     memory: object        — agent memory (not used here)
 *   }
 * }
 *
 * We respond with:
 * {
 *   success:    boolean
 *   output:     string      — human-readable result, shown in Paperclip UI
 *   data?:      object      — structured deal result (optional, for agent memory)
 *   tokensUsed: number      — always 0 (no LLM inference in this adapter)
 * }
 */
app.post('/heartbeat', async (req: Request, res: Response) => {
  const { runId, agentId, context } = req.body as {
    runId: string;
    agentId: string;
    context?: { task?: string; skills?: string[]; memory?: Record<string, unknown> };
  };

  const task = context?.task || '';

  console.log('\n--- Paperclip heartbeat received ---');
  console.log(`  runId:   ${runId}`);
  console.log(`  agentId: ${agentId}`);
  console.log(`  task:    ${task.substring(0, 120)}`);

  // If no purchase-related task, return idle status
  const isPurchaseTask = /purchase|buy|procure|order/i.test(task);
  if (!task || !isPurchaseTask) {
    return res.json({
      success: true,
      output: 'BCP buyer adapter running. No purchase task detected.',
      tokensUsed: 0,
    });
  }

  // Parse the task into structured purchase parameters
  const parsed = parsePurchaseTask(task);
  console.log(`  parsed:  ${JSON.stringify(parsed)}`);

  // Enforce spending limit — flag to Paperclip if over limit
  if (parsed.budget > MAX_AUTO_APPROVE) {
    console.log(`  BLOCKED: budget $${parsed.budget} exceeds autonomous limit $${MAX_AUTO_APPROVE}`);
    return res.json({
      success: false,
      output: `Purchase blocked: budget $${parsed.budget} USDC exceeds autonomous spending limit of $${MAX_AUTO_APPROVE} USDC. Human approval required.`,
      data: { requiresApproval: true, budget: parsed.budget, limit: MAX_AUTO_APPROVE },
      tokensUsed: 0,
    });
  }

  // Instantiate the BCP buyer
  // Keys and contract address are read from environment variables.
  let buyer: BCPBuyer;
  try {
    buyer = new BCPBuyer({ network: NETWORK });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('  BCPBuyer init failed:', msg);
    return res.json({
      success: false,
      output: `BCP buyer initialization failed: ${msg}`,
      tokensUsed: 0,
    });
  }

  console.log(`  buyer address: ${buyer.address}`);
  console.log(`  seller URL:    ${parsed.sellerUrl}`);
  console.log(`  budget:        $${parsed.budget} USDC`);
  if (parsed.counterPrice !== undefined) {
    console.log(`  counter price: $${parsed.counterPrice} USDC`);
  }

  // Execute the purchase
  let deal: BuyerDealResult;
  try {
    deal = await buyer.purchase({
      seller: parsed.sellerUrl,
      orgId: 'BuyerCorp',
      item: {
        description: parsed.description,
        qty: 1,
      },
      budget: parsed.budget,
      terms: 'immediate',
      ...(parsed.counterPrice !== undefined ? { counterPrice: parsed.counterPrice } : {}),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('  Purchase failed:', msg);
    return res.json({
      success: false,
      output: `Purchase failed: ${msg}`,
      tokensUsed: 0,
    });
  }

  // Format the result for Paperclip's UI
  const explorerBase = NETWORK === 'base' ? 'https://basescan.org' : 'https://sepolia.basescan.org';
  const output = [
    `Purchase complete.`,
    ``,
    `Item:        ${parsed.description}`,
    `Amount paid: $${deal.price} USDC`,
    `Status:      ${deal.state}`,
    ``,
    `Lock tx:     ${explorerBase}/tx/${deal.lockTxHash}`,
    `Release tx:  ${explorerBase}/tx/${deal.releaseTxHash}`,
    `Invoice:     ${deal.invoiceId}`,
    `Commit ID:   ${deal.commitId}`,
  ].join('\n');

  console.log('\n  Deal complete:');
  console.log(`    price:       $${deal.price} USDC`);
  console.log(`    lockTx:      ${deal.lockTxHash}`);
  console.log(`    releaseTx:   ${deal.releaseTxHash}`);
  console.log(`    invoice:     ${deal.invoiceId}`);

  return res.json({
    success: true,
    output,
    data: {
      commitId: deal.commitId,
      intentId: deal.intentId,
      price: deal.price,
      currency: deal.currency,
      lockTxHash: deal.lockTxHash,
      releaseTxHash: deal.releaseTxHash,
      invoiceId: deal.invoiceId,
      invoiceHash: deal.invoiceHash,
      state: deal.state,
    },
    tokensUsed: 0,
  });
});

// ── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log('\n┌──────────────────────────────────────────────────────┐');
  console.log('│  BuyerCorp — Paperclip BCP Buyer Adapter             │');
  console.log('│                                                        │');
  console.log(`│  Heartbeat endpoint:  http://localhost:${PORT}/heartbeat  │`);
  console.log(`│  Health check:        http://localhost:${PORT}/health      │`);
  console.log(`│  Network:             ${NETWORK.padEnd(28)}│`);
  console.log(`│  Default seller:      ${SELLER_BCP_URL.padEnd(28)}│`);
  console.log(`│  Spending limit:      $${String(MAX_AUTO_APPROVE).padEnd(27)}│`);
  console.log('│                                                        │');
  console.log('│  Configure in Paperclip:                               │');
  console.log(`│    Agent adapter URL: http://localhost:${PORT}/heartbeat  │`);
  console.log('│    Skill: bcp-buyer-skill.md                           │');
  console.log('└──────────────────────────────────────────────────────┘\n');
});
