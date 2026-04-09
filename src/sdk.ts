/**
 * BCP SDK — run a complete buyer+seller transaction in a single process.
 * Useful for demos and integration testing.
 *
 * @module sdk
 */

import { v4 as uuidv4 } from 'uuid';
import { ethers } from 'ethers';
import type {
  IntentMessage,
  QuoteMessage,
  CounterMessage,
  CommitMessage,
  FulfilMessage,
  BCPMessage,
} from './messages/types';
import { SessionManager } from './state/session';
import { OnChainEscrowProvider } from './escrow/onchain-escrow';
import { signMessage, generateKeypair } from './validation/signature';
import { createLogger, configureLogger, LogLevel } from './logger';
import { NETWORKS, NetworkConfig } from './buyer';

const log = createLogger('bcp-sdk');

// ── Config ─────────────────────────────────────────────────────────

export interface BCPConfig {
  network: string;
  contractAddress?: string;
  buyerKey?: string;
  sellerKey?: string;
  tokenAddress?: string;
  tokenDecimals?: number;
  logLevel?: LogLevel;
}

export interface TransactParams {
  buyer: { budget: number };
  seller: { endpoint?: string };
  service: string;
  sellerMarkup?: number;
  counterDiscount?: number;
}

export interface DealResult {
  sessionId: string;
  lockTxHash: string;
  releaseTxHash: string;
  lockUrl: string;
  releaseUrl: string;
  price: number;
  currency: string;
  state: string;
  messages: BCPMessage[];
}

// ── SDK ────────────────────────────────────────────────────────────

export class BCP {
  private network: NetworkConfig;
  private contractAddress: string;
  private buyerKey: string;
  private sellerKey: string;
  private buyerEd25519: { privateKey: string; publicKey: string };
  private sellerEd25519: { privateKey: string; publicKey: string };
  private explorerUrl: string;
  private tokenAddress: string;
  private tokenDecimals: number;

  constructor(config: BCPConfig) {
    const net = NETWORKS[config.network];
    if (!net && !config.network.startsWith('http')) {
      throw new Error(`Unknown network "${config.network}". Use: ${Object.keys(NETWORKS).join(', ')}`);
    }
    this.network = net || {
      chainId: 0, rpcUrl: config.network,
      usdcAddress: config.tokenAddress || '', usdcDecimals: config.tokenDecimals || 6, explorerUrl: '',
    };

    this.buyerKey = config.buyerKey || process.env.BUYER_EVM_PRIVATE_KEY || '';
    this.sellerKey = config.sellerKey || process.env.SELLER_EVM_PRIVATE_KEY || '';
    if (!this.buyerKey) throw new Error('Missing buyer EVM key.');
    if (!this.sellerKey) throw new Error('Missing seller EVM key.');

    this.contractAddress = config.contractAddress || process.env.BCP_ESCROW_CONTRACT_ADDRESS || '';
    if (!this.contractAddress) throw new Error('Missing escrow contract address.');

    this.tokenAddress = config.tokenAddress || this.network.usdcAddress;
    this.tokenDecimals = config.tokenDecimals ?? this.network.usdcDecimals;
    this.explorerUrl = this.network.explorerUrl;

    this.buyerEd25519 = generateKeypair();
    this.sellerEd25519 = generateKeypair();

    configureLogger({ level: config.logLevel ?? LogLevel.INFO });
  }

  /**
   * Execute a complete transaction:
   * INTENT → QUOTE → COUNTER → COMMIT (escrow lock) → FULFIL (escrow release)
   */
  async transact(params: TransactParams): Promise<DealResult> {
    const sessionManager = new SessionManager();
    const sessionId = uuidv4();
    const currency = 'USDC';
    const budget = params.buyer.budget;
    const markupFactor = 1 + (params.sellerMarkup || 15) / 100;
    const quotePrice = Math.round(budget * markupFactor * 100) / 100;
    const counterDiscount = params.counterDiscount ?? null;
    const finalPrice = counterDiscount !== null
      ? Math.round(quotePrice * (1 - counterDiscount / 100) * 100) / 100
      : budget;

    const buyerEscrow = new OnChainEscrowProvider({
      rpcUrl: this.network.rpcUrl,
      contractAddress: this.contractAddress,
      buyerPrivateKey: this.buyerKey,
      sellerAddress: new ethers.Wallet(this.sellerKey).address,
      tokenAddress: this.tokenAddress,
      tokenDecimals: this.tokenDecimals,
    });

    const sellerEscrow = OnChainEscrowProvider.createSellerInstance({
      rpcUrl: this.network.rpcUrl,
      contractAddress: this.contractAddress,
      sellerPrivateKey: this.sellerKey,
      buyerAddress: new ethers.Wallet(this.buyerKey).address,
      tokenAddress: this.tokenAddress,
      tokenDecimals: this.tokenDecimals,
    });

    // 1. INTENT
    log.info('INTENT', { service: params.service });
    const intent: IntentMessage = {
      bcp_version: '0.3',
      type: 'intent',
      sessionId,
      timestamp: new Date().toISOString(),
      service: params.service,
      budget,
      currency,
      auth: 'ed25519',
    };
    const signedIntent = { ...intent, signature: signMessage(intent as unknown as Record<string, unknown>, this.buyerEd25519.privateKey) };
    sessionManager.processMessage(signedIntent as unknown as BCPMessage);

    // 2. QUOTE
    log.info('QUOTE', { price: quotePrice });
    const quote: QuoteMessage = {
      bcp_version: '0.3',
      type: 'quote',
      sessionId,
      timestamp: new Date().toISOString(),
      price: quotePrice,
      currency,
      deliverables: [params.service],
      settlement: 'escrow',
    };
    const signedQuote = { ...quote, signature: signMessage(quote as unknown as Record<string, unknown>, this.sellerEd25519.privateKey) };
    sessionManager.processMessage(signedQuote as unknown as BCPMessage);

    // 3. COUNTER
    log.info('COUNTER', { proposed: finalPrice });
    const counter: CounterMessage = {
      bcp_version: '0.3',
      type: 'counter',
      sessionId,
      timestamp: new Date().toISOString(),
      counterPrice: finalPrice,
      reason: `Counter: ${finalPrice} USDC`,
    };
    const signedCounter = { ...counter, signature: signMessage(counter as unknown as Record<string, unknown>, this.buyerEd25519.privateKey) };
    sessionManager.processMessage(signedCounter as unknown as BCPMessage);

    // 4. Revised QUOTE
    log.info('Revised QUOTE', { price: finalPrice });
    const revisedQuote: QuoteMessage = {
      bcp_version: '0.3',
      type: 'quote',
      sessionId,
      timestamp: new Date().toISOString(),
      price: finalPrice,
      currency,
      deliverables: [params.service],
      settlement: 'escrow',
    };
    const signedRevisedQuote = { ...revisedQuote, signature: signMessage(revisedQuote as unknown as Record<string, unknown>, this.sellerEd25519.privateKey) };
    sessionManager.processMessage(signedRevisedQuote as unknown as BCPMessage);

    // 5. COMMIT + escrow lock
    log.info('COMMIT', { amount: finalPrice });
    const commit: CommitMessage = {
      bcp_version: '0.3',
      type: 'commit',
      sessionId,
      timestamp: new Date().toISOString(),
      agreedPrice: finalPrice,
      currency,
      settlement: 'escrow',
      escrow: { contractAddress: this.contractAddress },
    };
    const lockReceipt = await buyerEscrow.lock(commit);
    log.info('✓ ESCROW LOCKED', { tx: lockReceipt.tx_hash });
    const signedCommit = { ...commit, signature: signMessage(commit as unknown as Record<string, unknown>, this.buyerEd25519.privateKey) };
    sessionManager.processMessage(signedCommit as unknown as BCPMessage);

    // 6. FULFIL + escrow release
    log.info('FULFIL', {});
    const fulfil: FulfilMessage = {
      bcp_version: '0.3',
      type: 'fulfil',
      sessionId,
      timestamp: new Date().toISOString(),
      summary: 'Service delivered',
      deliverables: ['Completed'],
    };
    const releaseReceipt = await sellerEscrow.release(fulfil);
    log.info('✓ ESCROW RELEASED', { tx: releaseReceipt.tx_hash });
    const signedFulfil = { ...fulfil, signature: signMessage(fulfil as unknown as Record<string, unknown>, this.sellerEd25519.privateKey) };
    sessionManager.processMessage(signedFulfil as unknown as BCPMessage);

    const session = sessionManager.getSession(sessionId)!;
    return {
      sessionId,
      lockTxHash: lockReceipt.tx_hash || '',
      releaseTxHash: releaseReceipt.tx_hash,
      lockUrl: this.explorerUrl ? `${this.explorerUrl}/tx/${lockReceipt.tx_hash}` : '',
      releaseUrl: this.explorerUrl ? `${this.explorerUrl}/tx/${releaseReceipt.tx_hash}` : '',
      price: finalPrice,
      currency,
      state: session.state,
      messages: session.messages,
    };
  }
}
