/**
 * BCP Live Demo — real USDC escrow on Base Sepolia.
 *
 * Runs two AI companies through a complete B2B commerce cycle:
 *   1. BuyerCorp sends INTENT
 *   2. DataSeller Co responds with QUOTE
 *   3. BuyerCorp sends COUNTER
 *   4. DataSeller Co accepts with revised QUOTE
 *   5. BuyerCorp sends COMMIT → locks USDC in on-chain escrow
 *   6. DataSeller Co sends FULFIL → releases escrow
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
  ], provider);
  const buyerUSDC = await usdcContract.balanceOf(ids.buyer.evmAddress);
  const sellerUSDCBefore = await usdcContract.balanceOf(ids.seller.evmAddress);

  log.info('Wallet balances', {
    buyer_eth: ethers.formatEther(buyerBal),
    seller_eth: ethers.formatEther(sellerBal),
    buyer_usdc: ethers.formatUnits(buyerUSDC, USDC_DECIMALS),
    seller_usdc: ethers.formatUnits(sellerUSDCBefore, USDC_DECIMALS),
  });

  if (buyerBal === 0n) { log.error('Buyer has no ETH for gas'); process.exit(1); }
  if (buyerUSDC === 0n) { log.error('Buyer has no USDC'); process.exit(1); }

  const sessionManager = new SessionManager();

  const buyerEscrow: EscrowProvider = new OnChainEscrowProvider({
    rpcUrl: ids.rpcUrl,
    contractAddress: ids.escrowContractAddress,
    buyerPrivateKey: ids.buyer.evmPrivateKey,
    sellerAddress: ids.seller.evmAddress,
    tokenAddress: USDC_ADDRESS,
    tokenDecimals: USDC_DECIMALS,
  });

  const sellerEscrow: EscrowProvider = OnChainEscrowProvider.createSellerInstance({
    rpcUrl: ids.rpcUrl,
    contractAddress: ids.escrowContractAddress,
    sellerPrivateKey: ids.seller.evmPrivateKey,
    buyerAddress: ids.buyer.evmAddress,
    tokenAddress: USDC_ADDRESS,
    tokenDecimals: USDC_DECIMALS,
  });

  const buyerKeys = { privateKey: ids.buyer.ed25519PrivateKey, publicKey: ids.buyer.ed25519PublicKey };
  const sellerKeys = { privateKey: ids.seller.ed25519PrivateKey, publicKey: ids.seller.ed25519PublicKey };

  const buyer = createBuyerAgent(ids.buyer.orgId, sessionManager, buyerEscrow, buyerKeys);
  const seller = createSellerAgent(ids.seller.orgId, sessionManager, sellerEscrow, sellerKeys);

  const DEMO_AMOUNT = 2;

  log.info('━━━ Step 1: BuyerCorp sends INTENT ━━━');
  const intent = buyer.createIntent('Enterprise API Data Feed', DEMO_AMOUNT);
  log.info(`INTENT sent: ${intent.sessionId}`);

  log.info('━━━ Step 2: DataSeller responds with QUOTE ━━━');
  const quote1 = seller.createQuote(intent, DEMO_AMOUNT * 1.04);
  log.info(`QUOTE sent: ${quote1.sessionId} — price: ${quote1.price} USDC`);

  log.info('━━━ Step 3: BuyerCorp counters ━━━');
  const counter = buyer.createCounter(quote1, DEMO_AMOUNT);
  log.info(`COUNTER sent: ${counter.sessionId} — proposed: ${DEMO_AMOUNT} USDC`);

  log.info('━━━ Step 4: DataSeller accepts counter ━━━');
  const quote2 = seller.createCounterQuote(counter, intent, true);
  log.info(`QUOTE (revised): ${quote2.sessionId} — price: ${quote2.price} USDC`);

  log.info('━━━ Step 5: BuyerCorp commits — locking USDC in escrow ━━━');
  const commit = await buyer.createCommit(quote2);
  log.info(`COMMIT sent: ${commit.sessionId}`);

  log.info('Waiting for block confirmation...');
  await new Promise((resolve) => setTimeout(resolve, 4000));

  log.info('━━━ Step 6: DataSeller delivers and releases escrow ━━━');
  const { fulfil, invoiceXml } = await seller.createFulfil(commit, quote2);
  log.info(`FULFIL sent: ${fulfil.sessionId}`);

  const buyerUSDCAfter = await usdcContract.balanceOf(ids.buyer.evmAddress);
  const sellerUSDCAfter = await usdcContract.balanceOf(ids.seller.evmAddress);

  const session = sessionManager.getSession(intent.sessionId)!;

  log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log.info('TRANSACTION COMPLETE', {
    sessionId: intent.sessionId,
    price: `${quote2.price} USDC`,
    state: session.state,
    messages: session.messages.length,
  });

  log.info('USDC BALANCES', {
    buyer_before: ethers.formatUnits(buyerUSDC, USDC_DECIMALS),
    buyer_after: ethers.formatUnits(buyerUSDCAfter, USDC_DECIMALS),
    seller_before: ethers.formatUnits(sellerUSDCBefore, USDC_DECIMALS),
    seller_after: ethers.formatUnits(sellerUSDCAfter, USDC_DECIMALS),
  });

  log.info('MESSAGE FLOW', {
    flow: session.messages.map((msg) => `${msg.type} → ${msg.sessionId.substring(0, 8)}…`),
  });

  log.info('UBL INVOICE', { preview: invoiceXml.substring(0, 300) });
  log.info('All tx hashes viewable at: https://sepolia.basescan.org');
  log.info('Contract: ' + ids.escrowContractAddress);
  log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main().catch((err) => {
  log.error('Demo failed', { error: String(err) });
  process.exit(1);
});
