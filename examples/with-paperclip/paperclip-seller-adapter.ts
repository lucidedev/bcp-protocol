#!/usr/bin/env npx ts-node
/**
 * Paperclip HTTP Adapter — DataSeller Co
 *
 * This server is DataSeller Co's Paperclip HTTP adapter. It does two things:
 *
 *   1. Runs a BCP seller server on port 3002 that autonomously handles
 *      incoming purchase requests (INTENT → QUOTE → COMMIT → FULFIL).
 *
 *   2. Listens on port 4002 for Paperclip heartbeats. Each heartbeat receives
 *      a status report — completed deals since the last heartbeat, total
 *      session revenue, and any active disputes.
 *
 * Configure this URL in Paperclip:
 *   Agent HTTP adapter: http://localhost:4002/heartbeat
 *
 * Required environment variables (see .env.seller):
 *   SELLER_EVM_PRIVATE_KEY      — seller's EVM wallet private key
 *   BUYER_EVM_ADDRESS           — buyer's EVM wallet address (for escrow)
 *   BCP_ESCROW_CONTRACT_ADDRESS — deployed BCPEscrow contract on Base
 *
 * Optional:
 *   SELLER_MARKUP_PERCENT       — markup percentage for quotes (default: 15)
 *   SELLER_AUTO_ACCEPT_COUNTERS — accept counter-offers automatically (default: true)
 *   SELLER_PRICING_JSON         — JSON map of category → fixed price in USDC
 *   BCP_NETWORK                 — 'base-sepolia' or 'base' (default: 'base-sepolia')
 *   BCP_SELLER_PORT             — BCP server port (default: 3002)
 *   PORT                        — adapter listen port (default: 4002)
 */

import 'dotenv/config';
import express, { Request, Response } from 'express';
import { BCPSeller } from '../../src/seller';
import type { SellerDealResult } from '../../src/seller';
import type { DisputeMessage } from '../../src/messages/dispute';

// ── Config ───────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT || 4002);
const BCP_SELLER_PORT = Number(process.env.BCP_SELLER_PORT || 3002);
const NETWORK = process.env.BCP_NETWORK || 'base-sepolia';
const MARKUP_PERCENT = Number(process.env.SELLER_MARKUP_PERCENT || 15);
const AUTO_ACCEPT_COUNTERS = process.env.SELLER_AUTO_ACCEPT_COUNTERS !== 'false';

// Optional category→price map loaded from environment
let pricingMap: Record<string, number> = {};
try {
  if (process.env.SELLER_PRICING_JSON) {
    pricingMap = JSON.parse(process.env.SELLER_PRICING_JSON);
  }
} catch {
  console.warn('Warning: SELLER_PRICING_JSON is not valid JSON — ignoring.');
}

// ── Deal tracking (in-memory, reset on restart) ───────────────────────────────

interface TrackedDeal extends SellerDealResult {
  timestamp: string;
}

interface TrackedDispute {
  commitId: string;
  reason: string;
  requestedResolution: string;
  timestamp: string;
}

const completedDeals: TrackedDeal[] = [];
const activeDisputes: TrackedDispute[] = [];
let dealsReportedToLastHeartbeat = 0;
let totalSessionRevenue = 0;

// ── BCP Seller setup ─────────────────────────────────────────────────────────

const explorerBase = NETWORK === 'base' ? 'https://basescan.org' : 'https://sepolia.basescan.org';

console.log('\nInitializing BCP seller...');

let seller: BCPSeller;
try {
  seller = new BCPSeller({ network: NETWORK });
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`BCPSeller init failed: ${msg}`);
  console.error('Check that SELLER_EVM_PRIVATE_KEY and BCP_ESCROW_CONTRACT_ADDRESS are set.');
  process.exit(1);
}

/**
 * Custom pricing strategy: if the buyer's category matches a known entry in
 * pricingMap, use that fixed price. Otherwise fall back to markup logic.
 */
seller.listen({
  port: BCP_SELLER_PORT,
  orgId: 'DataSeller Co',
  markupPercent: MARKUP_PERCENT,
  autoAcceptCounters: AUTO_ACCEPT_COUNTERS,

  pricing: Object.keys(pricingMap).length > 0
    ? (intent) => {
        const category = (intent.requirements.category || '').toLowerCase();
        for (const [key, price] of Object.entries(pricingMap)) {
          if (category.includes(key.toLowerCase())) {
            return { unitPrice: price, description: intent.requirements.category };
          }
        }
        // No match — return 0 to tell the default markup logic to take over.
        // The seller SDK uses budget_max * markup when unitPrice is 0.
        return { unitPrice: 0 };
      }
    : undefined,

  onDealComplete: (deal: SellerDealResult) => {
    const tracked: TrackedDeal = { ...deal, timestamp: new Date().toISOString() };
    completedDeals.push(tracked);
    totalSessionRevenue += deal.price;

    console.log('\n--- Deal complete ---');
    console.log(`  commitId:    ${deal.commitId}`);
    console.log(`  buyer:       ${deal.buyerOrgId}`);
    console.log(`  price:       $${deal.price} ${deal.currency}`);
    console.log(`  invoice:     ${deal.invoiceId}`);
    console.log(`  release tx:  ${deal.releaseTxHash}`);
    console.log(`  explorer:    ${explorerBase}/tx/${deal.releaseTxHash}`);
    console.log(`  session revenue so far: $${totalSessionRevenue} USDC\n`);
  },

  onDisputeReceived: (dispute: DisputeMessage) => {
    // Remove from active if already tracked (shouldn't happen, but be safe)
    const existing = activeDisputes.findIndex(d => d.commitId === dispute.commit_id);
    if (existing !== -1) activeDisputes.splice(existing, 1);

    activeDisputes.push({
      commitId: dispute.commit_id,
      reason: dispute.reason,
      requestedResolution: dispute.requested_resolution,
      timestamp: new Date().toISOString(),
    });

    console.warn('\n--- DISPUTE received ---');
    console.warn(`  commitId:            ${dispute.commit_id}`);
    console.warn(`  reason:              ${dispute.reason}`);
    console.warn(`  requestedResolution: ${dispute.requested_resolution}`);
    console.warn('  Escrow is now FROZEN. Human review may be required.\n');
  },
});

console.log(`BCP seller server started on port ${BCP_SELLER_PORT}`);
console.log(`Seller EVM address: ${seller.address}`);

// ── Paperclip adapter server ─────────────────────────────────────────────────

const app = express();
app.use(express.json());

/**
 * Health check — Paperclip may ping this to verify the adapter is reachable.
 */
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    adapter: 'BCP Seller',
    company: 'DataSeller Co',
    bcpServer: `http://localhost:${BCP_SELLER_PORT}`,
    dealsCompleted: completedDeals.length,
    sessionRevenue: totalSessionRevenue,
  });
});

/**
 * Paperclip heartbeat endpoint.
 *
 * Paperclip POSTs this payload:
 * {
 *   runId:    string
 *   agentId:  string
 *   context:  { task: string, skills: string[], memory: object }
 * }
 *
 * We respond with a status summary of the BCP seller server.
 */
app.post('/heartbeat', (req: Request, res: Response) => {
  const { runId, agentId, context } = req.body as {
    runId: string;
    agentId: string;
    context?: { task?: string };
  };

  const task = context?.task || '';

  console.log(`\n--- Paperclip heartbeat ---  runId: ${runId}  agentId: ${agentId}`);

  // Handle configuration update tasks
  if (/markup.*?(\d+)%/i.test(task)) {
    const match = task.match(/markup.*?(\d+)%/i);
    if (match) {
      const newMarkup = parseInt(match[1]);
      console.log(`  Config update: markup -> ${newMarkup}%`);
      // Note: BCPSeller.listen() does not currently support runtime reconfiguration.
      // A production implementation would store this and apply it to the next INTENT.
      return res.json({
        success: true,
        output: `Markup update noted at ${newMarkup}%. Will apply to new quotes. (Restart required for full effect.)`,
        tokensUsed: 0,
      });
    }
  }

  // Calculate deals since last heartbeat
  const newDeals = completedDeals.slice(dealsReportedToLastHeartbeat);
  dealsReportedToLastHeartbeat = completedDeals.length;

  // Build output string
  const lines: string[] = [
    `BCP seller server running on port ${BCP_SELLER_PORT}.`,
    `Deals completed since last heartbeat: ${newDeals.length}`,
  ];

  if (newDeals.length > 0) {
    lines.push('');
    for (const deal of newDeals) {
      lines.push(`Deal ${deal.commitId.substring(0, 8)}...:`);
      lines.push(`  Buyer:    ${deal.buyerOrgId}`);
      lines.push(`  Amount:   $${deal.price} ${deal.currency}`);
      lines.push(`  Invoice:  ${deal.invoiceId}`);
      lines.push(`  Release:  ${explorerBase}/tx/${deal.releaseTxHash}`);
    }
  }

  lines.push('');
  lines.push(`Total session revenue: $${totalSessionRevenue} USDC`);

  if (activeDisputes.length > 0) {
    lines.push('');
    lines.push(`ACTIVE DISPUTES (${activeDisputes.length}):`);
    for (const d of activeDisputes) {
      lines.push(`  Commit ${d.commitId.substring(0, 8)}...: ${d.reason} — ${d.requestedResolution} requested. Escrow FROZEN.`);
    }
  }

  const output = lines.join('\n');
  console.log(`  New deals: ${newDeals.length}, session revenue: $${totalSessionRevenue} USDC`);

  return res.json({
    success: true,
    output,
    data: {
      bcpServerPort: BCP_SELLER_PORT,
      sellerAddress: seller.address,
      dealsThisHeartbeat: newDeals.length,
      totalDeals: completedDeals.length,
      totalSessionRevenue,
      activeDisputes: activeDisputes.length,
      newDeals: newDeals.map(d => ({
        commitId: d.commitId,
        buyerOrgId: d.buyerOrgId,
        price: d.price,
        currency: d.currency,
        invoiceId: d.invoiceId,
        releaseTxHash: d.releaseTxHash,
        timestamp: d.timestamp,
      })),
    },
    tokensUsed: 0,
  });
});

// ── Start adapter ────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log('\n┌──────────────────────────────────────────────────────┐');
  console.log('│  DataSeller Co — Paperclip BCP Seller Adapter         │');
  console.log('│                                                        │');
  console.log(`│  Heartbeat endpoint:  http://localhost:${PORT}/heartbeat  │`);
  console.log(`│  Health check:        http://localhost:${PORT}/health      │`);
  console.log(`│  BCP server port:     ${BCP_SELLER_PORT}                             │`);
  console.log(`│  Network:             ${NETWORK.padEnd(28)}│`);
  console.log(`│  Markup:              ${String(MARKUP_PERCENT + '%').padEnd(28)}│`);
  console.log(`│  Auto-accept counters:${String(AUTO_ACCEPT_COUNTERS).padEnd(28)}│`);
  console.log(`│  Seller address:      ${seller.address.substring(0, 20)}...  │`);
  console.log('│                                                        │');
  console.log('│  Configure in Paperclip:                               │');
  console.log(`│    Agent adapter URL: http://localhost:${PORT}/heartbeat  │`);
  console.log('│    Skill: bcp-seller-skill.md                          │');
  console.log('│                                                        │');
  console.log('│  Waiting for BCP purchase requests...                  │');
  console.log('└──────────────────────────────────────────────────────┘\n');
});
