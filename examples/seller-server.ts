#!/usr/bin/env npx ts-node
/**
 * BCP Seller Agent — runs in its own terminal.
 *
 * Start this first:
 *   npx ts-node examples/seller-server.ts
 *
 * Then run the buyer in another terminal:
 *   npx ts-node examples/buyer-client.ts
 */

import 'dotenv/config';
import { BCPSeller } from '../src/seller';

const PORT = Number(process.env.SELLER_PORT || 3001);

const seller = new BCPSeller({
  network: 'base-sepolia',
});

console.log('\n┌─────────────────────────────────────────────┐');
console.log('│  DataSeller — BCP Seller Agent               │');
console.log(`│  Address: ${seller.address}`);
console.log(`│  Port:    ${PORT}`);
console.log('│  Network: Base Sepolia                        │');
console.log('│  Waiting for incoming INTENT...               │');
console.log('└─────────────────────────────────────────────┘\n');

seller.listen({
  port: PORT,
  markupPercent: 15,
  autoAcceptCounters: true,
  onDealComplete: (deal) => {
    console.log('\n┌─────────────── DEAL COMPLETE ───────────────┐');
    console.log(`│  Session:  ${deal.sessionId}`);
    console.log(`│  Price:    ${deal.price} ${deal.currency}`);
    if (deal.releaseTxHash) console.log(`│  Release:  ${deal.releaseTxHash.substring(0, 20)}...`);
    console.log('└─────────────────────────────────────────────┘\n');
    console.log('Waiting for next INTENT...\n');
  },
});
