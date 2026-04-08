/**
 * BCP — 10 lines of code, real stablecoins on-chain.
 *
 * Run:  npx ts-node examples/demo-sdk.ts
 */

import 'dotenv/config';
import { BCP } from '../src';

async function main() {
  // Pre-flight: check required env vars
  const required = ['BUYER_EVM_PRIVATE_KEY', 'SELLER_EVM_PRIVATE_KEY', 'BCP_ESCROW_CONTRACT_ADDRESS'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`Missing .env variables: ${missing.join(', ')}`);
    process.exit(1);
  }

  const bcp = new BCP({ network: 'base-sepolia' });

  const deal = await bcp.transact({
    buyer:  { orgId: 'buyercorp',   budget: 25 },
    seller: { orgId: 'dataseller' },
    item:   { description: 'Q2 Market Research Report', qty: 1, unitPrice: 2 },
    terms:  'immediate',
  });

  console.log(`\n✅ Deal complete`);
  console.log(`   Price:    ${deal.price} ${deal.currency}`);
  console.log(`   Lock:     ${deal.lockUrl}`);
  console.log(`   Release:  ${deal.releaseUrl}`);
  console.log(`   Invoice:  ${deal.invoiceHash}`);
  console.log(`   State:    ${deal.state}`);
}

main().catch(console.error);
