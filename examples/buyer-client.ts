#!/usr/bin/env npx ts-node
/**
 * BCP Buyer Agent — runs in its own terminal.
 *
 * Start the seller first:
 *   npx ts-node examples/seller-server.ts
 *
 * Then run this:
 *   npx ts-node examples/buyer-client.ts
 */

import 'dotenv/config';
import { BCPBuyer } from '../src/buyer';

const SELLER_URL = process.env.SELLER_URL || 'http://localhost:3001';

async function main() {
  const buyer = new BCPBuyer({
    network: 'base-sepolia',
  });

  console.log('\n┌─────────────────────────────────────────────┐');
  console.log('│  BuyerCorp — BCP Buyer Agent                 │');
  console.log(`│  Address:  ${buyer.address}`);
  console.log(`│  Seller:   ${SELLER_URL}`);
  console.log('│  Network:  Base Sepolia                       │');
  console.log('└─────────────────────────────────────────────┘\n');

  console.log('Sending purchase request...\n');

  const deal = await buyer.purchase({
    seller: SELLER_URL,
    service: 'Q2 Market Research Report',
    budget: 25,
    currency: 'USDC',
    counterPrice: 2,
  });

  console.log('\n┌─────────────── DEAL COMPLETE ───────────────┐');
  console.log(`│  Session:    ${deal.sessionId}`);
  console.log(`│  Price:      $${deal.price} ${deal.currency}`);
  console.log(`│  State:      ${deal.state}`);
  if (deal.lockTxHash) console.log(`│  Lock tx:    ${deal.lockTxHash.substring(0, 20)}...`);
  if (deal.releaseTxHash) console.log(`│  Release tx: ${deal.releaseTxHash.substring(0, 20)}...`);
  if (deal.lockUrl) console.log(`│  Lock:       ${deal.lockUrl}`);
  if (deal.releaseUrl) console.log(`│  Release:    ${deal.releaseUrl}`);
  console.log('└─────────────────────────────────────────────┘\n');
}

main().catch((err) => {
  console.error('\nError:', err.message);
  process.exit(1);
});
