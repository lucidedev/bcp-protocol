#!/usr/bin/env npx ts-node
/**
 * BCP Multi-Seller RFQ Demo
 *
 * Demonstrates the requestQuotes() flow:
 *   1. Start 3 seller servers on ports 3001, 3002, 3003 — each with a
 *      different markup (20%, 10%, 15%).
 *   2. Buyer broadcasts an INTENT to all three simultaneously.
 *   3. Collect and rank quotes by price ascending.
 *   4. Commit to the cheapest quote.
 *   5. Print the winning seller and on-chain tx hash.
 *
 * Prerequisites:
 *   - Set env vars: BUYER_EVM_PRIVATE_KEY, SELLER_EVM_PRIVATE_KEY (shared
 *     for demo simplicity), BCP_ESCROW_CONTRACT_ADDRESS, BUYER_EVM_ADDRESS,
 *     SELLER_EVM_ADDRESS
 *
 * Run:
 *   npx ts-node examples/rfq-demo.ts
 *
 * @module examples/rfq-demo
 */

import 'dotenv/config';
import { BCPBuyer } from '../src/buyer';
import { BCPSeller } from '../src/seller';

// ── Seller configuration ───────────────────────────────────────────

interface SellerSpec {
  name: string;
  port: number;
  markupPercent: number;
}

const SELLERS: SellerSpec[] = [
  { name: 'SellerA', port: 3001, markupPercent: 20 },
  { name: 'SellerB', port: 3002, markupPercent: 10 },
  { name: 'SellerC', port: 3003, markupPercent: 15 },
];

const ITEM_DESCRIPTION = 'Q3 Cloud Compute Credits';
const ITEM_QTY = 1;
const BASE_UNIT_PRICE = 10;   // sellers mark up from here via budget_max hint
const BUDGET = 25;            // buyer's max spend
const TIMEOUT_MS = 20_000;    // 20 s — generous for demo startup time

// ── Helper: start a seller server and return a shutdown function ───

function startSeller(spec: SellerSpec): () => void {
  const seller = new BCPSeller({ network: 'base-sepolia' });

  seller.listen({
    port: spec.port,
    orgId: spec.name,
    markupPercent: spec.markupPercent,
    autoAcceptCounters: false, // RFQ — no counter-offers needed
    onDealComplete: (deal) => {
      console.log(`\n  [${spec.name}] Deal complete!`);
      console.log(`    Price:    ${deal.price} ${deal.currency}`);
      console.log(`    Invoice:  ${deal.invoiceId}`);
      console.log(`    Release:  ${deal.releaseTxHash}`);
    },
  });

  console.log(`  [${spec.name}] listening on port ${spec.port} (markup: ${spec.markupPercent}%)`);

  // seller.listen() starts an Express server; on process exit Node.js
  // will close all open handles automatically. For explicit shutdown,
  // wrap seller.listen() to capture and close the http.Server instance.
  return () => process.exit(0);
}

// ── Main demo ──────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n┌────────────────────────────────────────────────────────┐');
  console.log('│  BCP Multi-Seller RFQ Demo                             │');
  console.log('│  Three sellers, one buyer, best price wins             │');
  console.log('└────────────────────────────────────────────────────────┘\n');

  // ── Start sellers ────────────────────────────────────────────────
  console.log('Starting seller servers...');
  const shutdowns = SELLERS.map(startSeller);

  // Give the servers a moment to bind their ports before the buyer connects
  await new Promise(r => setTimeout(r, 1_500));

  // ── Create buyer ─────────────────────────────────────────────────
  const buyer = new BCPBuyer({ network: 'base-sepolia' });

  console.log(`\nBuyer address: ${buyer.address}`);
  console.log(`Item: "${ITEM_DESCRIPTION}" × ${ITEM_QTY}`);
  console.log(`Budget: ${BUDGET} USDC`);
  console.log(`Timeout: ${TIMEOUT_MS / 1000} s\n`);

  // ── Broadcast RFQ ────────────────────────────────────────────────
  console.log('Broadcasting INTENT to all sellers...');

  const sellerEndpoints = SELLERS.map(s => `http://localhost:${s.port}`);

  const rfq = await buyer.requestQuotes({
    sellers: sellerEndpoints,
    item: {
      description: ITEM_DESCRIPTION,
      qty: ITEM_QTY,
      unitPrice: BASE_UNIT_PRICE,
    },
    budget: BUDGET,
    currency: 'USDC',
    terms: ['immediate'],
    timeoutMs: TIMEOUT_MS,
  });

  // ── Print all quotes received ────────────────────────────────────
  console.log('\n── Quotes received (' + rfq.quotes.length + ') ──────────────────────────────────\n');

  for (const q of rfq.quotes) {
    const sellerSpec = SELLERS.find(s => sellerEndpoints.indexOf(q.sellerEndpoint) === SELLERS.indexOf(s));
    const sellerName = sellerSpec?.name ?? q.sellerEndpoint;
    const isBest = q.sellerEndpoint === rfq.best.sellerEndpoint;
    const marker = isBest ? ' ◀ WINNER' : '';
    console.log(`  ${sellerName} (${q.sellerEndpoint})`);
    console.log(`    Price:    ${q.quote.offer.price} ${q.quote.offer.currency}${marker}`);
    console.log(`    Terms:    ${q.quote.offer.payment_terms}`);
    console.log(`    Delivery: ${q.quote.offer.delivery_date.split('T')[0]}`);
    console.log();
  }

  if (rfq.timedOut.length > 0) {
    console.log(`  Timed out: ${rfq.timedOut.join(', ')}\n`);
  }

  console.log(`Best price: ${rfq.best.quote.offer.price} USDC from ${rfq.best.sellerEndpoint}`);
  console.log(`RFQ ID:     ${rfq.rfqId}\n`);

  // ── Commit to best quote ─────────────────────────────────────────
  console.log('Committing to best quote (locking escrow on-chain)...\n');

  const deal = await rfq.commit();

  // ── Result ───────────────────────────────────────────────────────
  const winnerSpec = SELLERS.find(s => `http://localhost:${s.port}` === rfq.best.sellerEndpoint);

  console.log('\n┌────────────────────── DEAL COMPLETE ──────────────────────┐');
  console.log(`│  Winner:     ${winnerSpec?.name ?? rfq.best.sellerEndpoint}`);
  console.log(`│  Price:      ${deal.price} ${deal.currency}`);
  console.log(`│  Commit ID:  ${deal.commitId}`);
  console.log(`│  Intent ID:  ${deal.intentId}`);
  console.log(`│  State:      ${deal.state}`);
  console.log('│');
  console.log(`│  Lock tx:    ${deal.lockTxHash}`);
  console.log(`│  Release tx: ${deal.releaseTxHash}`);
  if (deal.lockUrl) console.log(`│  Lock URL:   ${deal.lockUrl}`);
  if (deal.releaseUrl) console.log(`│  Release:    ${deal.releaseUrl}`);
  console.log(`│  Invoice:    ${deal.invoiceId}`);
  console.log('└────────────────────────────────────────────────────────────┘\n');

  // Clean up seller servers
  shutdowns.forEach(fn => fn());
  process.exit(0);
}

main().catch((err) => {
  console.error('\nRFQ demo failed:', err.message);
  if (process.env.DEBUG) console.error(err);
  process.exit(1);
});
