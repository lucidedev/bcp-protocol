#!/usr/bin/env npx ts-node
/**
 * BCP Seller — settlement via Finance District Prism
 *
 * This is an OPTIONAL upgrade to the standard seller-server.ts example.
 * BCP works fully standalone (see examples/seller-server.ts). This variant
 * replaces the direct on-chain escrow release with Prism as the x402
 * settlement backend.
 *
 * What Prism adds over the standalone implementation:
 *   - Prism's Spectrum layer executes and verifies stablecoin transfers on-chain
 *   - FDUSD support alongside USDC (Finance District's native stablecoin)
 *   - Settlement config lives in the Prism Console, not in env vars
 *   - Webhook delivery with tx hash, amount, payer, and chain for reconciliation
 *   - No seller-side RPC calls or gas management — Prism's facilitator handles it
 *
 * How x402 flows through BCP with Prism:
 *   Buyer sends COMMIT  →  BCP receives it  →  seller tries to serve /bcp/settle
 *   Prism intercepts  →  returns 402 to buyer  →  buyer's Agent Wallet signs
 *   Buyer retries with X-PAYMENT header  →  Prism verifies + settles on-chain
 *   Prism sets X-PAYMENT-RESPONSE header with tx hash  →  seller sends FULFIL
 *
 * Prerequisites:
 *   - District Pass account at https://fd.xyz
 *   - PRISM_API_KEY from https://console.fd.xyz
 *   - npm install @1stdigital/prism-express
 *
 * Docs: https://developers.fd.xyz/prism/sdk/typescript/express
 *
 * Run:
 *   PRISM_API_KEY=<key> npx ts-node examples/with-finance-district/seller-with-prism.ts
 */

import 'dotenv/config';
import express, { Request, Response } from 'express';
import {
  prismPaymentMiddleware,
  type PrismMiddlewareConfig,
  type RoutePaymentConfig,
} from '@1stdigital/prism-express';
import { BCPSeller } from '../../src/seller';
import { createLogger } from '../../src/logger';

const log = createLogger('seller-prism');

// ── Validate required config ────────────────────────────────────────

const PRISM_API_KEY = process.env.PRISM_API_KEY;
if (!PRISM_API_KEY) {
  console.error('\nMissing PRISM_API_KEY. Get yours at https://console.fd.xyz\n');
  process.exit(1);
}

const PORT    = Number(process.env.SELLER_PORT  || 3001);
const ORG_ID  = process.env.SELLER_ORG_ID       || 'dataseller-co';
// DEAL_AMOUNT drives the price Prism presents in the 402 challenge.
// In production this would come from your pricing engine or the negotiated
// BCP QUOTE price — here it defaults to $2.00 to match the demo buyer.
const DEAL_AMOUNT = process.env.DEAL_AMOUNT      || '$2.00';

// ── Prism configuration ─────────────────────────────────────────────

// These are the settings Prism uses to verify and settle x402 payments.
// The API key ties this server to your Prism Console project, where you
// configure which tokens and chains are accepted.
const prismConfig: PrismMiddlewareConfig = {
  apiKey:  PRISM_API_KEY,
  // Prism's hosted gateway — handles ERC-3009 verification and
  // on-chain settlement via the Spectrum layer. No RPC node needed.
  baseUrl: process.env.PRISM_BASE_URL || 'https://prism-gw.fd.xyz',
  debug:   process.env.NODE_ENV !== 'production',
};

// Routes that require x402 payment before the seller responds.
// When a COMMIT hits /bcp/settle without a valid X-PAYMENT header,
// Prism returns HTTP 402 with an acceptedPayments[] array the buyer's
// Agent Wallet uses to construct its signed ERC-3009 authorization.
const prismRoutes: Record<string, RoutePaymentConfig> = {
  '/bcp/settle': {
    price:       DEAL_AMOUNT,
    description: 'BCP agent commerce settlement',
    // mimeType defaults to application/json — matches BCP message format
  },
};

// ── Express app ─────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// Prism middleware MUST be registered before route handlers.
// It intercepts requests to /bcp/settle: if the X-PAYMENT header is absent
// or invalid, it short-circuits with 402. When payment verifies, it lets the
// request through to BCPSeller's handler and attaches X-PAYMENT-RESPONSE
// (the on-chain tx hash) to the response before it leaves the server.
app.use(prismPaymentMiddleware(prismConfig, prismRoutes));

// ── Settlement endpoint ─────────────────────────────────────────────

// This route is what BCPSeller internally POSTs to when a COMMIT arrives.
// Prism has already verified payment by the time we reach this handler.
// req.payer contains the buyer's wallet address (added by Prism middleware).
app.post('/bcp/settle', (req: Request, res: Response) => {
  // The X-PAYMENT-RESPONSE header is set by Prism's res.end() interception
  // after settlement confirms on-chain. BCPSeller reads it to include the
  // tx hash in the FULFIL message sent back to the buyer.
  const txHash = res.getHeader('X-PAYMENT-RESPONSE') as string | undefined;

  log.info('Settlement confirmed by Prism', {
    payer:  req.payer,   // buyer's EVM address
    txHash: txHash || 'pending',
  });

  res.json({
    settled:  true,
    payer:    req.payer,
    tx_hash:  txHash,
    settled_at: new Date().toISOString(),
  });
});

// ── BCP Seller ──────────────────────────────────────────────────────

// BCPSeller handles the BCP protocol: INTENT→QUOTE, COUNTER→QUOTE, COMMIT→FULFIL.
// The settlement step (releasing funds) is now delegated to Prism via the
// /bcp/settle endpoint above, rather than calling the BCPEscrow contract directly.
//
// Note: BCP_ESCROW_CONTRACT_ADDRESS is still used for escrow locking by the buyer.
// The seller no longer needs a funded EVM wallet for gas — Prism's facilitator
// executes the transfer when it verifies the buyer's ERC-3009 signature.
const seller = new BCPSeller({ network: 'base-sepolia' });

console.log('\n┌─────────────────────────────────────────────────────┐');
console.log('│  DataSeller — BCP Seller with Prism Settlement      │');
console.log('│                                                       │');
console.log(`│  Address:  ${seller.address}  │`);
console.log(`│  Port:     ${PORT}                                    │`);
console.log('│  Network:  Base Sepolia                               │');
console.log('│  Payment:  Prism (x402 / ERC-3009)                   │');
console.log(`│  Price:    ${DEAL_AMOUNT} per deal                          │`);
console.log('│                                                       │');
console.log('│  Prism Console: https://console.fd.xyz               │');
console.log('│  Docs:          https://developers.fd.xyz/prism      │');
console.log('│                                                       │');
console.log('│  Waiting for incoming INTENT...                       │');
console.log('└─────────────────────────────────────────────────────┘\n');

seller.listen({
  port:               PORT,
  orgId:              ORG_ID,
  markupPercent:      15,
  autoAcceptCounters: true,

  onDealComplete: (deal) => {
    console.log('\n┌─────────────── DEAL COMPLETE ───────────────────────┐');
    console.log(`│  Buyer:    ${deal.buyerOrgId}`);
    console.log(`│  Price:    ${deal.price} ${deal.currency}`);
    console.log(`│  Invoice:  ${deal.invoiceId}`);
    console.log(`│  Release:  ${deal.releaseTxHash.substring(0, 20)}...`);
    console.log(`│  Explorer: ${deal.releaseUrl}`);
    console.log('│');
    console.log('│  Settlement verified by Prism / Spectrum on-chain.');
    console.log('│  Check payment history: https://console.fd.xyz');
    console.log('└─────────────────────────────────────────────────────┘\n');
    console.log('Waiting for next INTENT...\n');
  },
});

// The Express app listens on the same port. BCPSeller's internal server and
// this Express app share the port: seller.listen() attaches BCP routes, and
// the Prism middleware wraps /bcp/settle before those routes are reached.
app.listen(PORT);
