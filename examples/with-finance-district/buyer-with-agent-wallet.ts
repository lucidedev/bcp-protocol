#!/usr/bin/env npx ts-node
/**
 * BCP Buyer — payment signing via Finance District Agent Wallet
 *
 * This is an OPTIONAL upgrade to the standard buyer-client.ts example.
 * BCP works fully standalone (see examples/buyer-client.ts). This variant
 * replaces raw EVM private key signing with Agent Wallet's TEE-secured signing.
 *
 * What Agent Wallet adds over the standalone implementation:
 *   - Private key is secured inside a Trusted Execution Environment (TEE)
 *     and never exposed in env vars, memory, or logs
 *   - EIP-3009 (transferWithAuthorization) signing — gasless for the payer,
 *     the Prism facilitator executes the on-chain transfer
 *   - Multi-chain, multi-token: Agent Wallet selects the right balance
 *     automatically (USDC on Base, FDUSD on BSC/Ethereum/Arbitrum, etc.)
 *   - The agent's identity is its District Pass account, not a raw key file
 *
 * How signing flows through BCP with Agent Wallet:
 *   Buyer sends COMMIT  →  seller's Prism middleware returns HTTP 402
 *   BCP buyer receives paymentRequirements (accepts[] array from Prism)
 *   agentWalletAuthorize() calls `fdx wallet authorizePayment` via CLI
 *   Agent Wallet selects network/token, signs ERC-3009 inside TEE
 *   Returns signed payment object  →  BCP retries request with X-PAYMENT header
 *   Prism verifies + settles on-chain  →  seller sends FULFIL
 *
 * The x402 authorizePayment flow (not getX402Content) is used here because
 * this process has full HTTP access. authorizePayment gives the agent maximum
 * autonomy: it decides whether to pay, manages the HTTP retry itself, and uses
 * the wallet only for the signing step it can't do without the TEE.
 *
 * Prerequisites:
 *   - District Pass account at https://fd.xyz
 *   - fdx CLI installed: npm install -g @financedistrict/fdx
 *   - Authenticated: fdx register --email you@example.com && fdx verify --code XXXXXXXX
 *   - Agent Wallet funded with USDC or FDUSD on Base Sepolia
 *
 * Docs: https://developers.fd.xyz/agent-wallet/ai-integration/cli
 *       https://developers.fd.xyz/agent-wallet/concepts/x402-payments
 *
 * Run:
 *   npx ts-node examples/with-finance-district/buyer-with-agent-wallet.ts
 */

import 'dotenv/config';
import { execSync } from 'child_process';
import { BCPBuyer } from '../../src/buyer';
import { createLogger } from '../../src/logger';

const log = createLogger('buyer-agent-wallet');

const SELLER_URL   = process.env.SELLER_URL  || 'http://localhost:3001';
const ORG_ID       = process.env.BUYER_ORG_ID || 'BuyerCorp';
// CURRENCY sets the preferred stablecoin. Agent Wallet will select the best
// available balance on the configured network automatically.
const CURRENCY     = process.env.CURRENCY    || 'USDC';

// ── Agent Wallet signing adapter ────────────────────────────────────

/**
 * Signs an x402 payment authorization using Agent Wallet's TEE.
 *
 * This replaces `wallet.signMessage()` on a raw EVM key. The private key
 * never leaves the secure enclave — Agent Wallet receives the payment
 * requirements from the Prism 402 response, selects the right
 * network/token pair based on your balance, constructs an ERC-3009
 * transferWithAuthorization, and returns the signed payload.
 *
 * The returned object has the shape:
 * {
 *   paymentPayload: { signature, authorization: { from, to, value, ... } },
 *   paymentRequirements: { x402Version, accepts: [...] }
 * }
 *
 * ERC-3009 means the on-chain transfer is gasless for this wallet —
 * Prism's Spectrum layer submits and pays gas on behalf of the buyer.
 *
 * @param paymentRequirements - The accepts[] array from the Prism 402 response
 * @returns Signed x402 payment object, ready to attach as X-PAYMENT header
 *
 * Docs: https://developers.fd.xyz/prism/integrations/x402/wallet
 */
async function agentWalletAuthorize(paymentRequirements: unknown): Promise<unknown> {
  log.info('Requesting TEE signing via Agent Wallet...');

  let result: string;
  try {
    // fdx wallet authorizePayment accepts the paymentRequirements JSON as a
    // positional argument and writes the signed payment object to stdout.
    // All fdx output is JSON — structured for tool-calling agents to parse.
    result = execSync(
      `fdx wallet authorizePayment '${JSON.stringify(paymentRequirements)}'`,
      {
        encoding: 'utf-8',
        // Inherit stderr so auth prompts surface if the session has expired.
        // In a fully automated pipeline, pre-authenticate with `fdx login`.
        stdio: ['inherit', 'pipe', 'inherit'],
      }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Agent Wallet signing failed. Ensure fdx is installed and authenticated.\n` +
      `  Install:  npm install -g @financedistrict/fdx\n` +
      `  Auth:     fdx register --email you@example.com\n` +
      `  Docs:     https://developers.fd.xyz/agent-wallet/ai-integration/cli\n` +
      `  Error:    ${message}`
    );
  }

  const signed = JSON.parse(result);

  log.info('TEE signing complete', {
    // Log only the payer address, never the signature or private key material
    payer: signed?.paymentPayload?.authorization?.from || 'unknown',
  });

  return signed;
}

// ── BCP Buyer ───────────────────────────────────────────────────────

async function main() {
  // BCPBuyer still manages the BCP protocol (INTENT, QUOTE, COUNTER, COMMIT).
  // The only change from the standalone buyer is that x402 payment signing
  // goes through agentWalletAuthorize() instead of directly signing with
  // BUYER_EVM_PRIVATE_KEY from .env.
  //
  // BUYER_EVM_PRIVATE_KEY is no longer required — Agent Wallet holds the key.
  // BCP_ESCROW_CONTRACT_ADDRESS is still needed for on-chain escrow locking.
  const buyer = new BCPBuyer({
    network: 'base-sepolia',
    // Inject the Agent Wallet signer. BCPBuyer calls this when it needs to
    // respond to a Prism 402 challenge during the COMMIT→FULFIL step.
    // Remove this line to fall back to raw BUYER_EVM_PRIVATE_KEY signing.
    paymentSigner: agentWalletAuthorize,
  });

  console.log('\n┌─────────────────────────────────────────────────────┐');
  console.log('│  BuyerCorp — BCP Buyer with Agent Wallet             │');
  console.log('│                                                       │');
  console.log(`│  Seller:   ${SELLER_URL}`);
  console.log(`│  Currency: ${CURRENCY}`);
  console.log('│  Signing:  Finance District Agent Wallet (TEE)       │');
  console.log('│                                                       │');
  console.log('│  Agent Wallet docs: https://developers.fd.xyz/       │');
  console.log('│         agent-wallet/concepts/x402-payments          │');
  console.log('└─────────────────────────────────────────────────────┘\n');

  console.log('Sending purchase request...\n');

  const deal = await buyer.purchase({
    seller:       SELLER_URL,
    orgId:        ORG_ID,
    item: {
      description: 'Q2 Market Research Report',
      qty:         1,
      unitPrice:   2,
    },
    budget:       25,
    counterPrice: 2,   // counter seller's marked-up quote back to $2
    terms:        'immediate',
    // Agent Wallet supports FDUSD natively alongside USDC.
    // Set CURRENCY=FDUSD in .env and ensure your Agent Wallet holds FDUSD
    // on a supported chain (BSC, Ethereum, Arbitrum).
    // The wallet selects the right chain/token pair from your balance
    // automatically when it processes the Prism 402 paymentRequirements.
    ...(CURRENCY === 'FDUSD' ? { currency: 'FDUSD' } : {}),
  });

  console.log('\n┌─────────────── DEAL COMPLETE ───────────────────────┐');
  console.log(`│  Price:      $${deal.price} ${deal.currency}`);
  console.log(`│  Lock tx:    ${deal.lockTxHash.substring(0, 20)}...`);
  console.log(`│  Release tx: ${deal.releaseTxHash.substring(0, 20)}...`);
  console.log(`│  Invoice:    ${deal.invoiceId}`);
  console.log(`│  State:      ${deal.state}`);
  console.log('│');
  console.log(`│  Lock:       ${deal.lockUrl}`);
  console.log(`│  Release:    ${deal.releaseUrl}`);
  console.log('│');
  console.log('│  Payment signed inside TEE — private key never exposed.');
  console.log('└─────────────────────────────────────────────────────┘\n');
}

main().catch((err) => {
  console.error('\nError:', err.message);
  process.exit(1);
});
