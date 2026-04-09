#!/usr/bin/env npx ts-node
/**
 * BCP Multi-Seller RFQ Demo
 *
 * Demonstrates the requestQuotes() flow:
 *   1. Start 3 seller servers on ports 3001, 3002, 3003
 *   2. Buyer broadcasts INTENT to all three simultaneously
 *   3. Collect and rank quotes by price ascending
 *   4. Commit to the cheapest quote
 *
 * Run:
 *   npx ts-node examples/rfq-demo.ts
 */

import 'dotenv/config';
import { BCPBuyer } from '../src/buyer';
import { BCPSeller } from '../src/seller';

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

const SERVICE = 'Q3 Cloud Compute Credits';
const BUDGET = 25;
const TIMEOUT_MS = 20_000;

function startSeller(spec: SellerSpec): () => void {
  const seller = new BCPSeller({ network: 'base-sepolia' });

  seller.listen({
    port: spec.port,
    markupPercent: spec.markupPercent,
    autoAcceptCounters: false,
    onDealComplete: (deal) => {
      console.log(`\n  [${spec.name}] Deal complete!`);
      console.log(`    Session:  ${deal.sessionId}`);
      console.log(`    Price:    ${deal.price} ${deal.currency}`);
    },
  });

  console.log(`  [${spec.name}] listening on port ${spec.port} (markup: ${spec.markupPercent}%)`);
  return () => process.exit(0);
}

async function main(): Promise<void> {
  console.log('\n┌────────────────────────────────────────────────────────┐');
  console.log('│  BCP Multi-Seller RFQ Demo                             │');
  console.log('│  Three sellers, one buyer, best price wins             │');
  console.log('└────────────────────────────────────────────────────────┘\n');

  console.log('Starting seller servers...');
  const shutdowns = SELLERS.map(startSeller);

  await new Promise(r => setTimeout(r, 1_500));

  const buyer = new BCPBuyer({ network: 'base-sepolia' });

  console.log(`\nBuyer address: ${buyer.address}`);
  console.log(`Service: "${SERVICE}"`);
  console.log(`Budget: ${BUDGET} USDC`);
  console.log(`Timeout: ${TIMEOUT_MS / 1000} s\n`);

  console.log('Broadcasting INTENT to all sellers...');

  const sellerEndpoints = SELLERS.map(s => `http://localhost:${s.port}`);

  const rfq = await buyer.requestQuotes({
    sellers: sellerEndpoints,
    service: SERVICE,
    budget: BUDGET,
    currency: 'USDC',
    timeoutMs: TIMEOUT_MS,
  });

  console.log('\n── Quotes received (' + rfq.quotes.length + ') ─────────────────────\n');

  for (const q of rfq.quotes) {
    const sellerSpec = SELLERS.find(s => sellerEndpoints.indexOf(q.sellerEndpoint) === SELLERS.indexOf(s));
    const sellerName = sellerSpec?.name ?? q.sellerEndpoint;
    const isBest = q.sellerEndpoint === rfq.best.sellerEndpoint;
    const marker = isBest ? ' ◀ WINNER' : '';
    console.log(`  ${sellerName} (${q.sellerEndpoint})`);
    console.log(`    Price: ${q.quote.price} ${q.quote.currency}${marker}`);
    console.log();
  }

  if (rfq.timedOut.length > 0) {
    console.log(`  Timed out: ${rfq.timedOut.join(', ')}\n`);
  }

  console.log(`Best price: ${rfq.best.quote.price} USDC from ${rfq.best.sellerEndpoint}`);
  console.log(`RFQ ID: ${rfq.rfqId}\n`);

  console.log('Committing to best quote (locking escrow on-chain)...\n');

  const deal = await rfq.commit();

  const winnerSpec = SELLERS.find(s => `http://localhost:${s.port}` === rfq.best.sellerEndpoint);

  console.log('\n┌────────────────────── DEAL COMPLETE ──────────────────────┐');
  console.log(`│  Winner:     ${winnerSpec?.name ?? rfq.best.sellerEndpoint}`);
  console.log(`│  Session:    ${deal.sessionId}`);
  console.log(`│  Price:      ${deal.price} ${deal.currency}`);
  console.log(`│  State:      ${deal.state}`);
  if (deal.lockTxHash) console.log(`│  Lock tx:    ${deal.lockTxHash}`);
  if (deal.releaseTxHash) console.log(`│  Release tx: ${deal.releaseTxHash}`);
  if (deal.lockUrl) console.log(`│  Lock URL:   ${deal.lockUrl}`);
  if (deal.releaseUrl) console.log(`│  Release:    ${deal.releaseUrl}`);
  console.log('└────────────────────────────────────────────────────────────┘\n');

  shutdowns.forEach(fn => fn());
  process.exit(0);
}

main().catch((err) => {
  console.error('\nRFQ demo failed:', err.message);
  process.exit(1);
});
