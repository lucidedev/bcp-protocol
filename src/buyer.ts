/**
 * BCP Buyer SDK — purchase, negotiate, and dispute using lean v0.3 messages.
 *
 * @module buyer
 */

import { v4 as uuidv4 } from 'uuid';
import { ethers } from 'ethers';
import type {
  IntentMessage,
  QuoteMessage,
  CommitMessage,
  DisputeMessage,
  BCPMessage,
} from './messages/types';
import { OnChainEscrowProvider } from './escrow/onchain-escrow';
import { BCPClient } from './transport/client';
import { signMessage, verifyMessage, generateKeypair } from './validation/signature';
import { createLogger, configureLogger, LogLevel } from './logger';

const log = createLogger('buyer');

// ── Network presets ────────────────────────────────────────────────

export interface NetworkConfig {
  chainId: number;
  rpcUrl: string;
  usdcAddress: string;
  usdcDecimals: number;
  explorerUrl: string;
}

export const NETWORKS: Record<string, NetworkConfig> = {
  'base-sepolia': {
    chainId: 84532,
    rpcUrl: 'https://sepolia.base.org',
    usdcAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    usdcDecimals: 6,
    explorerUrl: 'https://sepolia.basescan.org',
  },
  'base': {
    chainId: 8453,
    rpcUrl: 'https://mainnet.base.org',
    usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    usdcDecimals: 6,
    explorerUrl: 'https://basescan.org',
  },
};

// ── Config types ───────────────────────────────────────────────────

export interface BCPBuyerConfig {
  network: string;
  evmPrivateKey?: string;
  contractAddress?: string;
  ed25519?: { privateKey: string; publicKey: string };
  tokenAddress?: string;
  tokenDecimals?: number;
  logLevel?: LogLevel;
}

export interface PurchaseParams {
  seller: string;
  service: string;
  budget?: number;
  currency?: string;
  counterPrice?: number;
}

export interface BuyerDealResult {
  sessionId: string;
  price: number;
  currency: string;
  lockTxHash?: string;
  lockUrl?: string;
  releaseTxHash?: string;
  releaseUrl?: string;
  state: string;
}

export interface DisputeParams {
  seller: string;
  sessionId: string;
  reason: string;
  resolution?: 'refund' | 'redeliver' | 'negotiate';
}

export interface DisputeResult {
  sessionId: string;
  freezeTxHash?: string;
  freezeUrl?: string;
}

export interface UnfreezeResult {
  sessionId: string;
  approvalTxHash: string;
  approvalUrl: string;
  fullyUnfrozen: boolean;
}

export interface RFQParams {
  sellers: string[];
  service: string;
  budget?: number;
  currency?: string;
  timeoutMs?: number;
}

export interface RFQQuote {
  sellerEndpoint: string;
  quote: QuoteMessage;
  sessionId: string;
}

export interface RFQResult {
  rfqId: string;
  quotes: RFQQuote[];
  best: RFQQuote;
  timedOut: string[];
  commit: () => Promise<BuyerDealResult>;
  commitTo: (quote: RFQQuote) => Promise<BuyerDealResult>;
}

export type PricingStrategy = (intent: IntentMessage) => { unitPrice: number; description?: string };

// ── Buyer SDK ──────────────────────────────────────────────────────

export class BCPBuyer {
  private networkConfig: NetworkConfig;
  private contractAddress: string;
  private evmKey: string;
  private ed25519: { privateKey: string; publicKey: string };
  private explorerUrl: string;
  private tokenAddress: string;
  private tokenDecimals: number;

  constructor(config: BCPBuyerConfig) {
    const net = NETWORKS[config.network];
    if (!net && !config.network.startsWith('http')) {
      throw new Error(`Unknown network "${config.network}". Use: ${Object.keys(NETWORKS).join(', ')}`);
    }
    this.networkConfig = net || {
      chainId: 0, rpcUrl: config.network,
      usdcAddress: config.tokenAddress || '', usdcDecimals: config.tokenDecimals || 6, explorerUrl: '',
    };

    this.evmKey = config.evmPrivateKey || process.env.BUYER_EVM_PRIVATE_KEY || '';
    if (!this.evmKey) throw new Error('Missing buyer EVM key.');

    this.contractAddress = config.contractAddress || process.env.BCP_ESCROW_CONTRACT_ADDRESS || '';
    if (!this.contractAddress) throw new Error('Missing escrow contract address.');

    this.tokenAddress = config.tokenAddress || this.networkConfig.usdcAddress;
    this.tokenDecimals = config.tokenDecimals ?? this.networkConfig.usdcDecimals;
    this.explorerUrl = this.networkConfig.explorerUrl;

    this.ed25519 = config.ed25519 || (() => {
      const pk = process.env.BUYER_ED25519_PRIVATE_KEY;
      const pub = process.env.BUYER_ED25519_PUBLIC_KEY;
      return pk && pub ? { privateKey: pk, publicKey: pub } : generateKeypair();
    })();

    configureLogger({ level: config.logLevel ?? LogLevel.INFO });
  }

  get address(): string { return new ethers.Wallet(this.evmKey).address; }
  get publicKey(): string { return this.ed25519.publicKey; }

  /**
   * Execute a full purchase: INTENT → QUOTE → (COUNTER) → COMMIT → FULFIL.
   */
  async purchase(params: PurchaseParams): Promise<BuyerDealResult> {
    const client = new BCPClient({
      baseUrl: params.seller,
      privateKey: this.ed25519.privateKey,
    });

    const sessionId = uuidv4();
    const currency = params.currency || 'USDC';

    // 1. INTENT
    log.info('→ INTENT', { service: params.service });
    const intent: IntentMessage = {
      bcp_version: '0.3',
      type: 'intent',
      sessionId,
      timestamp: new Date().toISOString(),
      service: params.service,
      budget: params.budget,
      currency,
      auth: 'ed25519',
    };
    const intentRes = await client.send(intent as unknown as Record<string, unknown>);
    const quoteMsg = intentRes.response as unknown as QuoteMessage;
    if (!quoteMsg || quoteMsg.type !== 'quote') {
      throw new Error('Seller did not respond with a quote');
    }
    log.info('← QUOTE', { price: quoteMsg.price });

    // 2. COUNTER (optional)
    let finalPrice = quoteMsg.price;
    if (params.counterPrice !== undefined && params.counterPrice < quoteMsg.price) {
      log.info('→ COUNTER', { proposed: params.counterPrice });
      const counter = {
        bcp_version: '0.3' as const,
        type: 'counter' as const,
        sessionId,
        timestamp: new Date().toISOString(),
        counterPrice: params.counterPrice,
        reason: `Counter: ${params.counterPrice} ${currency}`,
      };
      const counterRes = await client.send(counter as unknown as Record<string, unknown>);
      const revised = counterRes.response as unknown as QuoteMessage;
      if (revised?.type === 'quote') {
        finalPrice = revised.price;
        log.info('← Revised QUOTE', { price: finalPrice });
      }
    }

    // 3. COMMIT + escrow lock
    log.info('→ COMMIT', { amount: finalPrice });
    const sellerEvmAddress = process.env.SELLER_EVM_ADDRESS || '';
    const escrow = new OnChainEscrowProvider({
      rpcUrl: this.networkConfig.rpcUrl,
      contractAddress: this.contractAddress,
      buyerPrivateKey: this.evmKey,
      sellerAddress: sellerEvmAddress,
      tokenAddress: this.tokenAddress,
      tokenDecimals: this.tokenDecimals,
    });

    const commitMsg: CommitMessage = {
      bcp_version: '0.3',
      type: 'commit',
      sessionId,
      timestamp: new Date().toISOString(),
      agreedPrice: finalPrice,
      currency,
      settlement: 'escrow',
      escrow: { contractAddress: this.contractAddress },
    };

    const lockReceipt = await escrow.lock(commitMsg);
    log.info('✓ ESCROW LOCKED', { tx: lockReceipt.tx_hash });

    const sig = signMessage(commitMsg as unknown as Record<string, unknown>, this.ed25519.privateKey);
    const signedCommit = { ...commitMsg, signature: sig };
    const commitRes = await client.send(signedCommit as unknown as Record<string, unknown>);

    let releaseTxHash = '';
    const fulfilMsg = commitRes.response as unknown as Record<string, unknown>;
    if (fulfilMsg?.type === 'fulfil') {
      releaseTxHash = (fulfilMsg.proofHash as string) || '';
    }

    return {
      sessionId,
      price: finalPrice,
      currency,
      lockTxHash: lockReceipt.tx_hash,
      lockUrl: this.explorerUrl ? `${this.explorerUrl}/tx/${lockReceipt.tx_hash}` : '',
      releaseTxHash,
      releaseUrl: this.explorerUrl && releaseTxHash ? `${this.explorerUrl}/tx/${releaseTxHash}` : '',
      state: commitRes.session_state,
    };
  }

  /**
   * Raise a dispute on a committed deal.
   */
  async dispute(params: DisputeParams): Promise<DisputeResult> {
    const client = new BCPClient({
      baseUrl: params.seller,
      privateKey: this.ed25519.privateKey,
    });

    const sellerEvmAddr = process.env.SELLER_EVM_ADDRESS || '';
    const escrow = new OnChainEscrowProvider({
      rpcUrl: this.networkConfig.rpcUrl,
      contractAddress: this.contractAddress,
      buyerPrivateKey: this.evmKey,
      sellerAddress: sellerEvmAddr,
      tokenAddress: this.tokenAddress,
      tokenDecimals: this.tokenDecimals,
    });

    const disputeMsg: DisputeMessage = {
      bcp_version: '0.3',
      type: 'dispute',
      sessionId: params.sessionId,
      timestamp: new Date().toISOString(),
      reason: params.reason,
      resolution: params.resolution,
    };

    log.info('→ DISPUTE', { sessionId: params.sessionId, reason: params.reason });
    const freezeReceipt = await escrow.freeze(disputeMsg);
    log.info('✓ ESCROW FROZEN', { tx: freezeReceipt.tx_hash });

    const sig = signMessage(disputeMsg as unknown as Record<string, unknown>, this.ed25519.privateKey);
    await client.send({ ...disputeMsg, signature: sig } as unknown as Record<string, unknown>);

    return {
      sessionId: params.sessionId,
      freezeTxHash: freezeReceipt.tx_hash,
      freezeUrl: this.explorerUrl ? `${this.explorerUrl}/tx/${freezeReceipt.tx_hash}` : '',
    };
  }

  /**
   * Approve unfreezing a disputed escrow.
   */
  async approveUnfreeze(sessionId: string): Promise<UnfreezeResult> {
    const sellerEvmAddr = process.env.SELLER_EVM_ADDRESS || '';
    const escrow = new OnChainEscrowProvider({
      rpcUrl: this.networkConfig.rpcUrl,
      contractAddress: this.contractAddress,
      buyerPrivateKey: this.evmKey,
      sellerAddress: sellerEvmAddr,
      tokenAddress: this.tokenAddress,
      tokenDecimals: this.tokenDecimals,
    });

    const approval = await escrow.approveUnfreeze(sessionId);

    return {
      sessionId,
      approvalTxHash: approval.tx_hash,
      approvalUrl: this.explorerUrl ? `${this.explorerUrl}/tx/${approval.tx_hash}` : '',
      fullyUnfrozen: approval.fully_unfrozen,
    };
  }

  /**
   * Broadcast an INTENT to multiple sellers, collect quotes, rank by price.
   */
  async requestQuotes(params: RFQParams): Promise<RFQResult> {
    const rfqId = uuidv4();
    const timeoutMs = params.timeoutMs ?? 15_000;
    const currency = params.currency ?? 'USDC';

    log.info('→ RFQ broadcast', { rfqId, sellers: params.sellers.length });

    const solicitOne = async (endpoint: string): Promise<RFQQuote> => {
      const sessionId = uuidv4();
      const client = new BCPClient({ baseUrl: endpoint, privateKey: this.ed25519.privateKey });

      const intent: IntentMessage = {
        bcp_version: '0.3',
        type: 'intent',
        sessionId,
        timestamp: new Date().toISOString(),
        service: params.service,
        budget: params.budget,
        currency,
        rfqId,
        auth: 'ed25519',
      };

      const res = await client.send(intent as unknown as Record<string, unknown>);
      const quoteMsg = res.response as unknown as QuoteMessage;

      if (!quoteMsg || quoteMsg.type !== 'quote') {
        throw new Error(`Seller ${endpoint} did not respond with a quote`);
      }

      return { sellerEndpoint: endpoint, quote: quoteMsg, sessionId };
    };

    const withTimeout = (endpoint: string): Promise<PromiseSettledResult<RFQQuote>> => {
      const timer = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout: ${endpoint}`)), timeoutMs)
      );
      return Promise.allSettled([Promise.race([solicitOne(endpoint), timer])]).then(([r]) => r);
    };

    const settled = await Promise.all(params.sellers.map(withTimeout));

    const quotes: RFQQuote[] = [];
    const timedOut: string[] = [];

    for (let i = 0; i < params.sellers.length; i++) {
      const result = settled[i];
      if (result.status === 'fulfilled') {
        quotes.push(result.value);
      } else {
        timedOut.push(params.sellers[i]);
      }
    }

    if (quotes.length === 0) throw new Error('No quotes received');

    quotes.sort((a, b) => a.quote.price - b.quote.price);
    const best = quotes[0];

    return {
      rfqId,
      quotes,
      best,
      timedOut,
      commit: () => this._commitToQuote(best),
      commitTo: (q: RFQQuote) => this._commitToQuote(q),
    };
  }

  private async _commitToQuote(rfqQuote: RFQQuote): Promise<BuyerDealResult> {
    return this.purchase({
      seller: rfqQuote.sellerEndpoint,
      service: `Commit to quote ${rfqQuote.sessionId}`,
      budget: rfqQuote.quote.price,
      currency: rfqQuote.quote.currency,
    });
  }

  private resolveSellerEvmAddress(_quoteMsg: unknown): string {
    return process.env.SELLER_EVM_ADDRESS || '';
  }
}
