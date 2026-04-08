#!/usr/bin/env npx ts-node
/**
 * BCP Buyer Agent — runs in its own terminal.
 *
 * Start the seller first:
 *   npx ts-node examples/seller-server.ts
 *
 * Then run this:
 *   npx ts-node examples/buyer-client.ts
 *
 * Two processes. Two companies. One blockchain transaction.
 */

import 'dotenv/config';
import { BCPBuyer } from '../src/buyer';

const SELLER_URL = process.env.SELLER_URL || 'http://localhost:3001';

async function main() {
  const buyer = new BCPBuyer({
    network: 'base-sepolia',
  });

  console.log('\n┌─────────────────────────────────────────────┐');
  console.log('│  🏢  BuyerCorp — BCP Buyer Agent             │');
  console.log('│                                               │');
  console.log(`│  Address:  ${buyer.address}  │`);
  console.log(`│  Seller:   ${SELLER_URL}              │`);
  console.log('│  Network:  Base Sepolia                       │');
  console.log('└─────────────────────────────────────────────┘\n');

  console.log('Sending purchase request...\n');

  const deal = await buyer.purchase({
    seller: SELLER_URL,
    orgId: 'BuyerCorp',
    item: {
      description: 'Q2 Market Research Report',
      qty: 1,
      unitPrice: 2,
    },
    budget: 25,
    counterPrice: 2,  // counter from seller's markup down to $2
    terms: 'immediate',
  });

  console.log('\n┌─────────────── DEAL COMPLETE ───────────────┐');
  console.log(`│  Price:      $${deal.price} USDC`);
  console.log(`│  Lock tx:    ${deal.lockTxHash.substring(0, 20)}...`);
  console.log(`│  Release tx: ${deal.releaseTxHash.substring(0, 20)}...`);
  console.log(`│  Invoice:    ${deal.invoiceId}`);
  console.log(`│  State:      ${deal.state}`);
  console.log('│');
  console.log(`│  🔗 Lock:    ${deal.lockUrl}`);
  console.log(`│  🔗 Release: ${deal.releaseUrl}`);
  console.log('└─────────────────────────────────────────────┘\n');
}

main().catch((err) => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});
