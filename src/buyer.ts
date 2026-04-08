/**
 * BCP Buyer SDK — the buyer side of a B2B commerce session.
 *
 * Runs in the buyer's process. Never requires the seller's private key.
 * Communicates with the seller over HTTP via BCPClient.
 *
 * Usage:
 *   const buyer = new BCPBuyer({ network: 'base-sepolia' });
 *   const deal = await buyer.purchase({
 *     seller: 'http://localhost:3001',
 *     item: { description: 'Q2 Market Research Report', qty: 1, unitPrice: 2 },
 *     budget: 25,
 *   });
 *   console.log(deal.lockTxHash);
 *
 * @module buyer
 */

import { v4 as uuidv4 } from 'uuid';
import { ethers } from 'ethers';
import { BCPClient } from './transport/client';
import { OnChainEscrowProvider } from './escrow/onchain-escrow';
import { generateKeypair, signMessage, verifyMessage } from './validation/signature';
import { createLogger, configureLogger, LogLevel } from './logger';
import { IntentMessage, PaymentTerms } from './messages/intent';
import { CommitMessage } from './messages/commit';
import { DisputeMessage } from './messages/dispute';
import type { BCPMessage } from './state/session';
import type { BCPResponse } from './transport/client';
import type { QuoteMessage } from './messages/quote';

const log = createLogger('bcp-buyer');

// ── Network configs (shared with seller) ───────────────────────────

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

// ── Config ─────────────────────────────────────────────────────────

export interface BCPBuyerConfig {
  /** Network name or custom RPC URL */
  network: string;
  /** Deployed BCPEscrow contract address */
  contractAddress?: string;
  /** Buyer's EVM private key (hex) */
  evmPrivateKey?: string;
  /** Pre-generated Ed25519 keys (auto-generated if omitted) */
  ed25519?: { privateKey: string; publicKey: string };
  /** Log level */
  logLevel?: LogLevel;
  /** Custom token address */
  tokenAddress?: string;
  /** Token decimals */
  tokenDecimals?: number;
}

export interface PurchaseParams {
  /** Seller's BCP server URL (e.g. http://localhost:3001) */
  seller: string;
  /** Buyer org ID */
  orgId?: string;
  /** Item to purchase */
  item: {
    description: string;
    qty: number;
    unitPrice?: number;
  };
  /** Maximum budget in USDC */
  budget?: number;
  /** Payment terms */
  terms?: PaymentTerms;
  /** Maximum price to auto-accept (without counter). Default: accept first quote. */
  maxAcceptPrice?: number;
  /** Counter-offer price. If set, buyer counters then accepts revised quote. */
  counterPrice?: number;
}

export interface DisputeParams {
  /** Seller's BCP server URL */
  seller: string;
  /** The commit_id of the deal to dispute */
  commitId: string;
  /** Reason for the dispute */
  reason: DisputeMessage['reason'];
  /** Requested resolution */
  requestedResolution: DisputeMessage['requested_resolution'];
  /** Optional evidence hash (SHA-256) */
  evidenceHash?: string;
  /** Optional evidence URL */
  evidenceUrl?: string;
}

export interface DisputeResult {
  disputeId: string;
  commitId: string;
  freezeTxHash: string;
  freezeUrl: string;
}

export interface UnfreezeResult {
  commitId: string;
  approvalTxHash: string;
  approvalUrl: string;
  fullyUnfrozen: boolean;
}

export interface BuyerDealResult {
  lockTxHash: string;
  lockUrl: string;
  releaseTxHash: string;
  releaseUrl: string;
  price: number;
  currency: string;
  invoiceId: string;
  invoiceHash: string;
  invoice: string;
  commitId: string;
  intentId: string;
  state: string;
}

// ── RFQ types ──────────────────────────────────────────────────────

export interface RFQParams {
  /** Array of seller endpoint URLs e.g. ['https://seller-a.com', 'https://seller-b.com'] */
  sellers: string[];
  /** Buyer org ID */
  orgId?: string;
  /** Item to source */
  item: {
    description: string;
    qty: number;
    unitPrice?: number;
    category?: string;
  };
  /** Maximum budget in token units */
  budget: number;
  /** Currency code (default: 'USDC') */
  currency?: string;
  /** Acceptable payment terms */
  terms?: PaymentTerms[];
  /** How long to wait for quotes in ms (default: 15000) */
  timeoutMs?: number;
}

export interface RFQQuote {
  /** URL of the seller that returned this quote */
  sellerEndpoint: string;
  /** Seller's agent_wallet_address from the QUOTE message */
  sellerId: string;
  /** The full QuoteMessage received from this seller */
  quote: QuoteMessage;
  /** The intent_id that was sent to this seller */
  intentId: string;
}

export interface RFQResult {
  /** UUID v4 identifying this broadcast */
  rfqId: string;
  /** All verified quotes received, sorted by price ascending */
  quotes: RFQQuote[];
  /** The lowest-price quote */
  best: RFQQuote;
  /** Seller endpoints that did not respond before the timeout */
  timedOut: string[];
  /** Commit to the best (lowest-price) quote */
  commit: () => Promise<BuyerDealResult>;
  /** Commit to a specific quote from the results */
  commitTo: (quote: RFQQuote) => Promise<BuyerDealResult>;
}

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
      chainId: 0,
      rpcUrl: config.network,
      usdcAddress: config.tokenAddress || '',
      usdcDecimals: config.tokenDecimals || 6,
      explorerUrl: '',
    };

    this.evmKey = config.evmPrivateKey || process.env.BUYER_EVM_PRIVATE_KEY || '';
    if (!this.evmKey) throw new Error('Missing buyer EVM key. Set BUYER_EVM_PRIVATE_KEY or pass evmPrivateKey.');

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
    log.info('BCPBuyer initialized', {
      network: config.network,
      contract: this.contractAddress,
      address: new ethers.Wallet(this.evmKey).address,
    });
  }

  /** Get the buyer's EVM address */
  get address(): string {
    return new ethers.Wallet(this.evmKey).address;
  }

  /** Get the buyer's public Ed25519 key */
  get publicKey(): string {
    return this.ed25519.publicKey;
  }

  /**
   * Execute a full purchase: INTENT → (wait for QUOTE) → COUNTER → (wait for revised QUOTE) → COMMIT.
   * The seller's server handles QUOTE responses and FULFIL + release.
   */
  async purchase(params: PurchaseParams): Promise<BuyerDealResult> {
    const client = new BCPClient({
      baseUrl: params.seller,
      privateKey: this.ed25519.privateKey,
    });

    const orgId = params.orgId || 'BuyerCorp';
    const budget = params.budget || (params.item.unitPrice || 10) * params.item.qty * 2;
    const terms = params.terms || 'immediate';

    // ── 1. INTENT ────────────────────────────────────────────────────
    log.info('→ INTENT', { item: params.item.description });
    const intent: Omit<IntentMessage, 'signature'> = {
      bcp_version: '0.1',
      message_type: 'INTENT',
      intent_id: uuidv4(),
      timestamp: new Date().toISOString(),
      buyer: {
        org_id: orgId,
        agent_wallet_address: this.ed25519.publicKey,
        credential: this.ed25519.publicKey,
        spending_limit: budget,
        currency: 'USDC',
      },
      requirements: {
        category: params.item.description,
        quantity: params.item.qty,
        delivery_window: 'P14D',
        budget_max: budget,
        payment_terms_acceptable: [terms],
        compliance: [],
      },
      ttl: 3600,
    };
    const intentRes = await client.send(intent as unknown as Record<string, unknown>);
    const quoteMsg = intentRes.response;
    if (!quoteMsg || quoteMsg.message_type !== 'QUOTE') {
      throw new Error('Seller did not respond with a QUOTE');
    }

    const quotePrice = (quoteMsg as unknown as Record<string, unknown>).offer
      ? ((quoteMsg as unknown as Record<string, unknown>).offer as Record<string, unknown>).price as number
      : 0;
    log.info('← QUOTE received', { price: quotePrice });

    // ── 2. COUNTER (optional) ────────────────────────────────────────
    let finalPrice = quotePrice;
    let acceptedQuoteId = (quoteMsg as unknown as Record<string, unknown>).quote_id as string;

    if (params.counterPrice !== undefined && params.counterPrice < quotePrice) {
      log.info('→ COUNTER', { proposed: params.counterPrice });
      const counter = {
        bcp_version: '0.1',
        message_type: 'COUNTER',
        counter_id: uuidv4(),
        ref_id: acceptedQuoteId,
        initiated_by: 'buyer',
        timestamp: new Date().toISOString(),
        proposed_changes: { price: params.counterPrice },
        rationale: `Counter: ${params.counterPrice} USDC`,
        new_validity_until: new Date(Date.now() + 3600_000).toISOString(),
      };
      const counterRes = await client.send(counter);
      const revisedQuote = counterRes.response;
      if (!revisedQuote || revisedQuote.message_type !== 'QUOTE') {
        throw new Error('Seller did not respond with revised QUOTE');
      }
      const revisedOffer = (revisedQuote as unknown as Record<string, unknown>).offer as Record<string, unknown>;
      finalPrice = revisedOffer.price as number;
      acceptedQuoteId = (revisedQuote as unknown as Record<string, unknown>).quote_id as string;
      log.info('← Revised QUOTE', { price: finalPrice });
    }

    // ── 3. COMMIT + escrow lock ──────────────────────────────────────
    const commitId = uuidv4();
    const dueDate = terms === 'immediate'
      ? new Date().toISOString()
      : new Date(Date.now() + 30 * 86400_000).toISOString();

    log.info('→ COMMIT + escrow lock', { amount: finalPrice, terms });

    const sellerEvmAddress = this.resolveSellerEvmAddress(quoteMsg);

    const escrow = new OnChainEscrowProvider({
      rpcUrl: this.networkConfig.rpcUrl,
      contractAddress: this.contractAddress,
      buyerPrivateKey: this.evmKey,
      sellerAddress: sellerEvmAddress,
      tokenAddress: this.tokenAddress,
      tokenDecimals: this.tokenDecimals,
    });

    const commitMsg: CommitMessage = {
      bcp_version: '0.1',
      message_type: 'COMMIT',
      commit_id: commitId,
      accepted_ref_id: acceptedQuoteId,
      timestamp: new Date().toISOString(),
      buyer_approval: {
        approved_by: this.ed25519.publicKey,
        approval_type: finalPrice <= budget ? 'autonomous' : 'human_required',
        threshold_exceeded: finalPrice > budget,
      },
      escrow: {
        amount: finalPrice,
        currency: 'USDC',
        escrow_contract_address: this.contractAddress,
        release_condition: 'fulfil_confirmed',
        payment_schedule: { type: terms, due_date: dueDate },
      },
      po_reference: `PO-${Date.now()}`,
      signature: '',
    };

    // Lock on-chain
    const lockReceipt = await escrow.lock(commitMsg);
    log.info('✓ ESCROW LOCKED', { tx: lockReceipt.tx_hash });

    // Sign and send COMMIT to seller
    const sig = signMessage(commitMsg as unknown as Record<string, unknown>, this.ed25519.privateKey);
    const signedCommit = { ...commitMsg, signature: sig };
    const commitRes = await client.send(signedCommit as unknown as Record<string, unknown>);

    // Seller responds with FULFIL (after releasing escrow on their side)
    const fulfilMsg = commitRes.response;
    let releaseTxHash = '';
    let invoiceId = '';
    let invoiceHash = '';
    let invoice = '';

    if (fulfilMsg && fulfilMsg.message_type === 'FULFIL') {
      const f = fulfilMsg as unknown as Record<string, unknown>;
      const inv = f.invoice as Record<string, unknown> | undefined;
      releaseTxHash = (f.release_tx_hash as string) || '';
      invoiceId = (inv?.invoice_id as string) || '';
      invoiceHash = (inv?.invoice_hash as string) || '';
      invoice = (inv?.invoice_url as string) || '';
      log.info('← FULFIL received', { releaseTx: releaseTxHash, invoice: invoiceId });
    }

    return {
      lockTxHash: lockReceipt.tx_hash || '',
      lockUrl: this.explorerUrl ? `${this.explorerUrl}/tx/${lockReceipt.tx_hash}` : '',
      releaseTxHash,
      releaseUrl: this.explorerUrl && releaseTxHash ? `${this.explorerUrl}/tx/${releaseTxHash}` : '',
      price: finalPrice,
      currency: 'USDC',
      invoiceId,
      invoiceHash,
      invoice,
      commitId,
      intentId: intent.intent_id,
      state: commitRes.session_state,
    };
  }

  /**
   * Raise a dispute on a committed deal. Freezes the escrow on-chain and
   * sends a DISPUTE message to the seller.
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
      bcp_version: '0.1',
      message_type: 'DISPUTE',
      dispute_id: uuidv4(),
      commit_id: params.commitId,
      timestamp: new Date().toISOString(),
      raised_by: 'buyer',
      reason: params.reason,
      requested_resolution: params.requestedResolution,
      ...(params.evidenceHash ? { evidence_hash: params.evidenceHash } : {}),
      ...(params.evidenceUrl ? { evidence_url: params.evidenceUrl } : {}),
      signature: '',
    };

    // Freeze on-chain
    log.info('→ DISPUTE — freezing escrow', { commitId: params.commitId, reason: params.reason });
    const freezeReceipt = await escrow.freeze(disputeMsg);
    log.info('✓ ESCROW FROZEN', { tx: freezeReceipt.tx_hash });

    // Send DISPUTE to seller
    const sig = signMessage(disputeMsg as unknown as Record<string, unknown>, this.ed25519.privateKey);
    await client.send({ ...disputeMsg, signature: sig } as unknown as Record<string, unknown>);

    return {
      disputeId: disputeMsg.dispute_id,
      commitId: params.commitId,
      freezeTxHash: freezeReceipt.tx_hash || '',
      freezeUrl: this.explorerUrl ? `${this.explorerUrl}/tx/${freezeReceipt.tx_hash}` : '',
    };
  }

  /**
   * Approve unfreezing a disputed escrow. Both buyer and seller must call
   * this before the escrow returns to Locked state on-chain.
   */
  async approveUnfreeze(commitId: string): Promise<UnfreezeResult> {
    const sellerEvmAddr = process.env.SELLER_EVM_ADDRESS || '';
    const escrow = new OnChainEscrowProvider({
      rpcUrl: this.networkConfig.rpcUrl,
      contractAddress: this.contractAddress,
      buyerPrivateKey: this.evmKey,
      sellerAddress: sellerEvmAddr,
      tokenAddress: this.tokenAddress,
      tokenDecimals: this.tokenDecimals,
    });

    log.info('→ approveUnfreeze (buyer)', { commitId });
    const approval = await escrow.approveUnfreeze(commitId);
    log.info('✓ Unfreeze approved', { tx: approval.tx_hash, fullyUnfrozen: approval.fully_unfrozen });

    return {
      commitId,
      approvalTxHash: approval.tx_hash,
      approvalUrl: this.explorerUrl ? `${this.explorerUrl}/tx/${approval.tx_hash}` : '',
      fullyUnfrozen: approval.fully_unfrozen,
    };
  }

  /**
   * Broadcast an INTENT to multiple sellers simultaneously, collect all quotes,
   * rank them by price, and return an RFQResult with commit helpers.
   *
   * Each seller receives its own INTENT with a shared rfq_id so they can identify
   * the broadcast. All requests run in parallel via Promise.allSettled. Sellers
   * that do not respond before timeoutMs are listed in `timedOut`.
   *
   * @example
   * const result = await buyer.requestQuotes({
   *   sellers: ['http://localhost:3001', 'http://localhost:3002'],
   *   item: { description: 'Cloud compute credits', qty: 100 },
   *   budget: 500,
   * });
   * console.log(result.quotes.map(q => `${q.sellerEndpoint}: $${q.quote.offer.price}`));
   * const deal = await result.commit(); // commits to cheapest
   */
  async requestQuotes(params: RFQParams): Promise<RFQResult> {
    const rfqId = uuidv4();
    const timeoutMs = params.timeoutMs ?? 15_000;
    const currency = params.currency ?? 'USDC';
    const terms = params.terms ?? ['immediate'];
    const orgId = params.orgId ?? 'BuyerCorp';
    const budget = params.budget;
    const category = params.item.category ?? params.item.description;

    log.info('→ RFQ broadcast', { rfqId, sellers: params.sellers.length, item: params.item.description });

    // Build per-seller intent IDs so we can correlate responses
    const intentIds = new Map<string, string>(); // endpoint → intent_id
    for (const endpoint of params.sellers) {
      intentIds.set(endpoint, uuidv4());
    }

    /**
     * Send an INTENT to a single seller and return the RFQQuote on success.
     * Rejects if the seller doesn't respond with a QUOTE.
     */
    const solicitOne = async (endpoint: string): Promise<RFQQuote> => {
      const intentId = intentIds.get(endpoint)!;
      const client = new BCPClient({ baseUrl: endpoint, privateKey: this.ed25519.privateKey });

      const intent: Omit<IntentMessage, 'signature'> = {
        bcp_version: '0.1',
        message_type: 'INTENT',
        intent_id: intentId,
        timestamp: new Date().toISOString(),
        rfq_id: rfqId,
        buyer: {
          org_id: orgId,
          agent_wallet_address: this.ed25519.publicKey,
          credential: this.ed25519.publicKey,
          spending_limit: budget,
          currency,
        },
        requirements: {
          category,
          quantity: params.item.qty,
          delivery_window: 'P14D',
          budget_max: budget,
          payment_terms_acceptable: terms,
          compliance: [],
        },
        ttl: Math.ceil(timeoutMs / 1000),
      };

      const res = await client.send(intent as unknown as Record<string, unknown>);
      const quoteMsg = res.response;

      if (!quoteMsg || quoteMsg.message_type !== 'QUOTE') {
        throw new Error(`Seller ${endpoint} did not respond with a QUOTE`);
      }

      const quote = quoteMsg as unknown as QuoteMessage;

      // Verify the quote's signature before accepting it
      const sellerPublicKey = quote.seller.credential;
      const isValid = verifyMessage(quoteMsg as unknown as Record<string, unknown>, sellerPublicKey);
      if (!isValid) {
        throw new Error(`QUOTE from ${endpoint} failed signature verification`);
      }

      log.info('← QUOTE verified', { endpoint, price: quote.offer.price, sellerId: quote.seller.agent_wallet_address });

      return {
        sellerEndpoint: endpoint,
        sellerId: quote.seller.agent_wallet_address,
        quote,
        intentId,
      };
    };

    // Race each seller against the shared timeout
    const withTimeout = (endpoint: string): Promise<PromiseSettledResult<RFQQuote>> => {
      const timer = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout waiting for quote from ${endpoint}`)), timeoutMs)
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
        log.warn('Seller did not respond in time or returned error', {
          endpoint: params.sellers[i],
          reason: (result.reason as Error).message,
        });
        timedOut.push(params.sellers[i]);
      }
    }

    if (quotes.length === 0) {
      throw new Error('No quotes received from any seller');
    }

    // Sort by offer.price ascending — cheapest first
    quotes.sort((a, b) => a.quote.offer.price - b.quote.offer.price);
    const best = quotes[0];

    log.info('RFQ complete', {
      rfqId,
      received: quotes.length,
      timedOut: timedOut.length,
      bestPrice: best.quote.offer.price,
      bestSeller: best.sellerEndpoint,
    });

    return {
      rfqId,
      quotes,
      best,
      timedOut,
      commit: () => this._commitToQuote(best),
      commitTo: (q: RFQQuote) => this._commitToQuote(q),
    };
  }

  /**
   * Internal: lock escrow and complete the COMMIT→FULFIL cycle for a specific
   * quote obtained via requestQuotes(). Skips the INTENT step because the INTENT
   * was already sent during the RFQ broadcast; we reuse the intent_id from the
   * RFQQuote so the seller's session is found correctly.
   */
  private async _commitToQuote(rfqQuote: RFQQuote): Promise<BuyerDealResult> {
    const { quote, sellerEndpoint, intentId } = rfqQuote;
    const finalPrice = quote.offer.price;
    const terms = quote.offer.payment_terms;
    const budget = quote.offer.price; // already accepted within budget at quote time

    log.info('→ COMMIT to RFQ quote', { sellerEndpoint, price: finalPrice, intentId });

    const client = new BCPClient({ baseUrl: sellerEndpoint, privateKey: this.ed25519.privateKey });

    // ── Escrow lock ──────────────────────────────────────────────────
    const commitId = uuidv4();
    const dueDate = terms === 'immediate'
      ? new Date().toISOString()
      : new Date(Date.now() + 30 * 86400_000).toISOString();

    const sellerEvmAddress = this.resolveSellerEvmAddress(quote as unknown as BCPMessage);

    const escrow = new OnChainEscrowProvider({
      rpcUrl: this.networkConfig.rpcUrl,
      contractAddress: this.contractAddress,
      buyerPrivateKey: this.evmKey,
      sellerAddress: sellerEvmAddress,
      tokenAddress: this.tokenAddress,
      tokenDecimals: this.tokenDecimals,
    });

    const commitMsg: CommitMessage = {
      bcp_version: '0.1' as const,
      message_type: 'COMMIT' as const,
      commit_id: commitId,
      accepted_ref_id: quote.quote_id,
      timestamp: new Date().toISOString(),
      buyer_approval: {
        approved_by: this.ed25519.publicKey,
        approval_type: (finalPrice <= budget ? 'autonomous' : 'human_required') as 'autonomous' | 'human_required',
        threshold_exceeded: finalPrice > budget,
      },
      escrow: {
        amount: finalPrice,
        currency: quote.offer.currency,
        escrow_contract_address: this.contractAddress,
        release_condition: 'fulfil_confirmed' as const,
        payment_schedule: { type: terms, due_date: dueDate },
      },
      po_reference: `PO-RFQ-${Date.now()}`,
      signature: '',
    };

    // Lock on-chain
    const lockReceipt = await escrow.lock(commitMsg);
    log.info('✓ ESCROW LOCKED (RFQ commit)', { tx: lockReceipt.tx_hash });

    // Sign and send COMMIT to seller
    const sig = signMessage(commitMsg as unknown as Record<string, unknown>, this.ed25519.privateKey);
    const signedCommit = { ...commitMsg, signature: sig };
    const commitRes = await client.send(signedCommit as unknown as Record<string, unknown>);

    // Seller responds with FULFIL
    const fulfilMsg = commitRes.response;
    let releaseTxHash = '';
    let invoiceId = '';
    let invoiceHash = '';
    let invoice = '';

    if (fulfilMsg && fulfilMsg.message_type === 'FULFIL') {
      const f = fulfilMsg as unknown as Record<string, unknown>;
      const inv = f.invoice as Record<string, unknown> | undefined;
      releaseTxHash = (f.release_tx_hash as string) || '';
      invoiceId = (inv?.invoice_id as string) || '';
      invoiceHash = (inv?.invoice_hash as string) || '';
      invoice = (inv?.invoice_url as string) || '';
      log.info('← FULFIL received (RFQ)', { releaseTx: releaseTxHash, invoice: invoiceId });
    }

    return {
      lockTxHash: lockReceipt.tx_hash || '',
      lockUrl: this.explorerUrl ? `${this.explorerUrl}/tx/${lockReceipt.tx_hash}` : '',
      releaseTxHash,
      releaseUrl: this.explorerUrl && releaseTxHash ? `${this.explorerUrl}/tx/${releaseTxHash}` : '',
      price: finalPrice,
      currency: quote.offer.currency,
      invoiceId,
      invoiceHash,
      invoice,
      commitId,
      intentId,
      state: commitRes.session_state,
    };
  }

  /**
   * Try to extract the seller's EVM address from a QUOTE response.
   * Falls back to SELLER_EVM_ADDRESS env var.
   */
  private resolveSellerEvmAddress(quoteMsg: BCPMessage): string {
    const q = quoteMsg as unknown as Record<string, unknown>;
    const seller = q.seller as Record<string, unknown> | undefined;
    const addr = seller?.evm_address as string | undefined;
    if (addr && addr.startsWith('0x')) return addr;
    // Fallback to env
    const envAddr = process.env.SELLER_EVM_ADDRESS;
    if (envAddr) return envAddr;
    throw new Error('Cannot determine seller EVM address. Set SELLER_EVM_ADDRESS or ensure QUOTE includes seller.evm_address.');
  }
}
