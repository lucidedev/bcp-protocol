/**
 * BCP Live Demo — real USDC escrow on Base Sepolia.
 *
 * Runs two AI companies through a complete B2B commerce cycle:
 *   1. BuyerCorp sends INTENT (procurement need)
 *   2. DataSeller Co responds with QUOTE
 *   3. BuyerCorp sends COUNTER (lower price)
 *   4. DataSeller Co accepts with revised QUOTE
 *   5. BuyerCorp sends COMMIT → locks USDC in on-chain escrow
 *   6. DataSeller Co sends FULFIL → releases escrow, generates UBL invoice
 *
 * Every step produces real Basescan tx hashes.
 *
 * Run:  npx ts-node examples/demo-live.ts
 */

import { ethers } from 'ethers';
import { SessionManager, EscrowProvider, createLogger, configureLogger, LogLevel } from '../src';
import { OnChainEscrowProvider } from '../src/escrow/onchain-escrow';
import { loadIdentities } from '../src/identity/keys';
import { createBuyerAgent } from './buyer-agent';
import { createSellerAgent } from './seller-agent';

const log = createLogger('demo-live');

/** USDC on Base Sepolia (Circle testnet, 6 decimals) */
const USDC_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const USDC_DECIMALS = 6;

async function main(): Promise<void> {
  configureLogger({ level: LogLevel.DEBUG });

  const ids = loadIdentities();

  if (!ids.escrowContractAddress) {
    log.error('BCP_ESCROW_CONTRACT_ADDRESS not set in .env — deploy the contract first');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(ids.rpcUrl);

  // Pre-flight checks
  log.info('Pre-flight checks', {
    chain: 'Base Sepolia (84532)',
    contract: ids.escrowContractAddress,
    usdc: USDC_ADDRESS,
    buyer: ids.buyer.evmAddress,
    seller: ids.seller.evmAddress,
  });

  const buyerBal = await provider.getBalance(ids.buyer.evmAddress);
  const sellerBal = await provider.getBalance(ids.seller.evmAddress);
  const usdcContract = new ethers.Contract(USDC_ADDRESS, [
    'function balanceOf(address account) external view returns (uint256)',
    'function decimals() external view returns (uint8)',
  ], provider);
  const buyerUSDC = await usdcContract.balanceOf(ids.buyer.evmAddress);
  const sellerUSDCBefore = await usdcContract.balanceOf(ids.seller.evmAddress);

  log.info('Wallet balances', {
    buyer_eth: ethers.formatEther(buyerBal),
    seller_eth: ethers.formatEther(sellerBal),
    buyer_usdc: ethers.formatUnits(buyerUSDC, USDC_DECIMALS),
    seller_usdc: ethers.formatUnits(sellerUSDCBefore, USDC_DECIMALS),
  });

  if (buyerBal === 0n) {
    log.error('Buyer has no ETH for gas — fund the wallet first');
    process.exit(1);
  }
  if (buyerUSDC === 0n) {
    log.error('Buyer has no USDC — fund the wallet first');
    process.exit(1);
  }

  // ── Infrastructure setup ─────────────────────────────────────────
  const sessionManager = new SessionManager();

  // Buyer-side escrow provider (USDC mode)
  const buyerEscrow: EscrowProvider = new OnChainEscrowProvider({
    rpcUrl: ids.rpcUrl,
    contractAddress: ids.escrowContractAddress,
    buyerPrivateKey: ids.buyer.evmPrivateKey,
    sellerAddress: ids.seller.evmAddress,
    tokenAddress: USDC_ADDRESS,
    tokenDecimals: USDC_DECIMALS,
  });

  // Seller-side escrow provider (for release calls)
  const sellerEscrow: EscrowProvider = OnChainEscrowProvider.createSellerInstance({
    rpcUrl: ids.rpcUrl,
    contractAddress: ids.escrowContractAddress,
    sellerPrivateKey: ids.seller.evmPrivateKey,
    buyerAddress: ids.buyer.evmAddress,
    tokenAddress: USDC_ADDRESS,
    tokenDecimals: USDC_DECIMALS,
  });

  // Agent keypairs
  const buyerKeys = { privateKey: ids.buyer.ed25519PrivateKey, publicKey: ids.buyer.ed25519PublicKey };
  const sellerKeys = { privateKey: ids.seller.ed25519PrivateKey, publicKey: ids.seller.ed25519PublicKey };

  const buyer = createBuyerAgent(ids.buyer.orgId, sessionManager, buyerEscrow, buyerKeys);
  const seller = createSellerAgent(ids.seller.orgId, sessionManager, sellerEscrow, sellerKeys);

  log.info('Agents initialized', {
    buyer: `${buyer.config.orgId} (BuyerCorp)`,
    seller: `${seller.config.orgId} (DataSeller Co)`,
  });

  // ── Demo amount: 2 USDC ───────────────────────────────────────────
  const DEMO_AMOUNT = 2;  // 2 USDC

  // ── Step 1: INTENT ───────────────────────────────────────────────
  log.info('━━━ Step 1: BuyerCorp declares procurement need ━━━');
  const intent = buyer.createIntent('Enterprise API Data Feed', 1, DEMO_AMOUNT);
  log.info(`INTENT sent: ${intent.intent_id}`);

  // ── Step 2: QUOTE ────────────────────────────────────────────────
  log.info('━━━ Step 2: DataSeller Co responds with quote ━━━');
  // Unit price such that total (qty * unitPrice * 1.15 markup) ≈ 12 USDC
  const quote1 = seller.createQuote(intent, DEMO_AMOUNT * 1.04);
  log.info(`QUOTE sent: ${quote1.quote_id} — price: ${quote1.offer.price} USDC`);

  // ── Step 3: COUNTER ──────────────────────────────────────────────
  log.info('━━━ Step 3: BuyerCorp counters with lower price ━━━');
  const counter = buyer.createCounter(quote1, DEMO_AMOUNT);
  log.info(`COUNTER sent: ${counter.counter_id} — proposed: ${DEMO_AMOUNT} USDC`);

  // ── Step 4: Revised QUOTE ────────────────────────────────────────
  log.info('━━━ Step 4: DataSeller Co accepts counter ━━━');
  const quote2 = seller.createCounterQuote(counter, intent, true);
  // Override to immediate payment for demo (so escrow can be released now)
  quote2.offer.payment_terms = 'immediate';
  log.info(`QUOTE (revised) sent: ${quote2.quote_id} — price: ${quote2.offer.price} USDC`);

  // ── Step 5: COMMIT + ESCROW LOCK (real on-chain tx) ──────────────
  log.info('━━━ Step 5: BuyerCorp commits — locking USDC in escrow ━━━');
  const commit = await buyer.createCommit(quote2);
  log.info(`COMMIT sent: ${commit.commit_id}`);
  log.info('Escrow LOCKED on Base Sepolia');

  // Wait for the lock to propagate across RPC nodes before releasing
  log.info('Waiting for block confirmation...');
  await new Promise((resolve) => setTimeout(resolve, 4000));

  // ── Step 6: FULFIL + ESCROW RELEASE (real on-chain tx) ───────────
  log.info('━━━ Step 6: DataSeller Co delivers and releases escrow ━━━');
  const { fulfil, invoiceXml } = await seller.createFulfil(commit, quote2);
  log.info(`FULFIL sent: ${fulfil.fulfil_id}`);
  log.info('Escrow RELEASED on Base Sepolia');

  // ── Post-trade balances ──────────────────────────────────────────
  const buyerUSDCAfter = await usdcContract.balanceOf(ids.buyer.evmAddress);
  const sellerUSDCAfter = await usdcContract.balanceOf(ids.seller.evmAddress);

  const session = sessionManager.getSession(intent.intent_id)!;

  log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log.info('TRANSACTION COMPLETE', {
    intent_id: intent.intent_id,
    negotiated_price: `${quote2.offer.price} USDC`,
    commit_id: commit.commit_id,
    fulfil_id: fulfil.fulfil_id,
    final_state: session.state,
    messages: session.messages.length,
  });

  log.info('USDC BALANCES', {
    buyer_before: ethers.formatUnits(buyerUSDC, USDC_DECIMALS),
    buyer_after: ethers.formatUnits(buyerUSDCAfter, USDC_DECIMALS),
    seller_before: ethers.formatUnits(sellerUSDCBefore, USDC_DECIMALS),
    seller_after: ethers.formatUnits(sellerUSDCAfter, USDC_DECIMALS),
  });

  log.info('MESSAGE FLOW', {
    flow: session.messages.map((msg) => {
      let id = '?';
      switch (msg.message_type) {
        case 'INTENT': id = msg.intent_id; break;
        case 'QUOTE': id = msg.quote_id; break;
        case 'COUNTER': id = msg.counter_id; break;
        case 'COMMIT': id = msg.commit_id; break;
        case 'FULFIL': id = msg.fulfil_id; break;
        case 'DISPUTE': id = msg.dispute_id; break;
      }
      return `${msg.message_type} → ${id.substring(0, 8)}…`;
    }),
  });

  log.info('UBL INVOICE', { preview: invoiceXml.substring(0, 300) });

  log.info('All tx hashes viewable at: https://sepolia.basescan.org');
  log.info('Contract: ' + ids.escrowContractAddress);

  log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log.info('Demo complete — no humans, no mocks, real USDC on Base Sepolia');
}

main().catch((err) => {
  log.error('Demo failed', { error: String(err) });
  process.exit(1);
});
