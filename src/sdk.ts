/**
 * BCP SDK — high-level API for the Business Commerce Protocol.
 *
 * Wraps all protocol internals (signing, sessions, escrow, invoicing)
 * behind a simple developer interface.
 *
 * Usage:
 *   const bcp = new BCP({ network: 'base-sepolia' });
 *   const deal = await bcp.transact({ ... });
 *   console.log(deal.txHash);
 *
 * @module sdk
 */

import { v4 as uuidv4 } from 'uuid';
import { ethers } from 'ethers';
import { SessionManager, BCPMessage } from './state/session';
import { OnChainEscrowProvider } from './escrow/onchain-escrow';
import { EscrowProvider, EscrowReceipt, ReleaseReceipt } from './escrow/escrow';
import { generateKeypair, signMessage } from './validation/signature';
import { generateUBLInvoice, UBLInvoiceResult } from './invoice/ubl-generator';
import { createLogger, configureLogger, LogLevel } from './logger';
import { IntentMessage, PaymentTerms } from './messages/intent';
import { QuoteMessage } from './messages/quote';
import { CounterMessage } from './messages/counter';
import { CommitMessage } from './messages/commit';
import { FulfilMessage } from './messages/fulfil';

const log = createLogger('bcp-sdk');

// ── Known networks ─────────────────────────────────────────────────

interface NetworkConfig {
  chainId: number;
  rpcUrl: string;
  usdcAddress: string;
  usdcDecimals: number;
  explorerUrl: string;
}

const NETWORKS: Record<string, NetworkConfig> = {
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

export interface BCPConfig {
  /** Network name or custom RPC URL */
  network: string;
  /** Deployed BCPEscrow contract address (auto-loaded from env if omitted) */
  contractAddress?: string;
  /** Buyer's EVM private key (auto-loaded from env if omitted) */
  buyerKey?: string;
  /** Seller's EVM private key (auto-loaded from env if omitted) */
  sellerKey?: string;
  /** Log level (default: INFO) */
  logLevel?: LogLevel;
  /** Custom USDC token address (override network default) */
  tokenAddress?: string;
  /** Token decimals (default: 6 for USDC) */
  tokenDecimals?: number;
}

export interface TransactParams {
  buyer: {
    orgId: string;
    budget?: number;
  };
  seller: {
    orgId: string;
    endpoint?: string;
  };
  item: {
    description: string;
    qty: number;
    unitPrice?: number;
  };
  /** Payment terms (default: 'immediate') */
  terms?: PaymentTerms;
  /** Seller markup percentage (default: 0 for direct price) */
  sellerMarkup?: number;
  /** Counter discount percentage — how much the buyer counters off the quote (default: match unitPrice) */
  counterDiscount?: number;
}

export interface DealResult {
  /** On-chain transaction hash for escrow lock */
  lockTxHash: string;
  /** On-chain transaction hash for escrow release */
  releaseTxHash: string;
  /** Block explorer URL for escrow lock */
  lockUrl: string;
  /** Block explorer URL for escrow release */
  releaseUrl: string;
  /** UBL 2.1 invoice XML */
  invoice: string;
  /** Invoice SHA-256 hash */
  invoiceHash: string;
  /** Contract address */
  contractAddress: string;
  /** Final negotiated price */
  price: number;
  /** Currency */
  currency: string;
  /** All BCP message IDs in order */
  messageIds: string[];
  /** Session state (should be FULFILLED) */
  state: string;
  /** Full message flow for debugging */
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
    // Resolve network
    const net = NETWORKS[config.network];
    if (!net && !config.network.startsWith('http')) {
      throw new Error(`Unknown network "${config.network}". Use: ${Object.keys(NETWORKS).join(', ')} or a custom RPC URL.`);
    }
    this.network = net || {
      chainId: 0,
      rpcUrl: config.network,
      usdcAddress: config.tokenAddress || '',
      usdcDecimals: config.tokenDecimals || 6,
      explorerUrl: '',
    };

    // Resolve keys (config > env > error)
    this.buyerKey = config.buyerKey
      || process.env.BUYER_EVM_PRIVATE_KEY
      || '';
    this.sellerKey = config.sellerKey
      || process.env.SELLER_EVM_PRIVATE_KEY
      || '';

    if (!this.buyerKey) throw new Error('Missing buyer EVM key. Set BUYER_EVM_PRIVATE_KEY or pass buyerKey.');
    if (!this.sellerKey) throw new Error('Missing seller EVM key. Set SELLER_EVM_PRIVATE_KEY or pass sellerKey.');

    // Resolve contract address
    this.contractAddress = config.contractAddress
      || process.env.BCP_ESCROW_CONTRACT_ADDRESS
      || '';
    if (!this.contractAddress) throw new Error('Missing escrow contract address. Set BCP_ESCROW_CONTRACT_ADDRESS or pass contractAddress.');

    // Token config
    this.tokenAddress = config.tokenAddress || this.network.usdcAddress;
    this.tokenDecimals = config.tokenDecimals ?? this.network.usdcDecimals;

    // Explorer
    this.explorerUrl = this.network.explorerUrl;

    // Ed25519 signing keys (from env or generate fresh)
    this.buyerEd25519 = {
      privateKey: process.env.BUYER_ED25519_PRIVATE_KEY || '',
      publicKey: process.env.BUYER_ED25519_PUBLIC_KEY || '',
    };
    this.sellerEd25519 = {
      privateKey: process.env.SELLER_ED25519_PRIVATE_KEY || '',
      publicKey: process.env.SELLER_ED25519_PUBLIC_KEY || '',
    };
    if (!this.buyerEd25519.privateKey) this.buyerEd25519 = generateKeypair();
    if (!this.sellerEd25519.privateKey) this.sellerEd25519 = generateKeypair();

    // Configure logging
    configureLogger({ level: config.logLevel ?? LogLevel.INFO });

    log.info('BCP initialized', {
      network: config.network,
      contract: this.contractAddress,
      buyer: new ethers.Wallet(this.buyerKey).address,
      seller: new ethers.Wallet(this.sellerKey).address,
    });
  }

  /**
   * Execute a complete B2B transaction:
   * INTENT → QUOTE → COUNTER (optional) → COMMIT (escrow lock) → FULFIL (escrow release)
   *
   * Returns transaction hashes, invoice, and full message trail.
   */
  async transact(params: TransactParams): Promise<DealResult> {
    const terms = params.terms || 'immediate';
    const sessionManager = new SessionManager();

    // Escrow providers
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

    const buyerAddr = this.buyerEd25519.publicKey;
    const sellerAddr = this.sellerEd25519.publicKey;
    const budget = params.buyer.budget || params.item.qty * (params.item.unitPrice || 0) * 2;
    const unitPrice = params.item.unitPrice || budget / params.item.qty;
    const markupFactor = 1 + (params.sellerMarkup || 15) / 100;
    const quotePrice = Math.round(params.item.qty * unitPrice * markupFactor * 100) / 100;
    const counterDiscount = params.counterDiscount ?? null;
    const finalPrice = params.item.unitPrice
      ? params.item.qty * params.item.unitPrice
      : counterDiscount !== null
        ? Math.round(quotePrice * (1 - counterDiscount / 100) * 100) / 100
        : Math.round(unitPrice * params.item.qty * 100) / 100; // counter back to base price

    // ── 1. INTENT ──────────────────────────────────────────────────
    log.info('INTENT', { buyer: params.buyer.orgId, item: params.item.description });
    const intent = this.sign<IntentMessage>({
      bcp_version: '0.1',
      message_type: 'INTENT',
      intent_id: uuidv4(),
      timestamp: new Date().toISOString(),
      buyer: {
        org_id: params.buyer.orgId,
        agent_wallet_address: buyerAddr,
        credential: buyerAddr,
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
    }, this.buyerEd25519.privateKey);
    sessionManager.processMessage(intent);

    // ── 2. QUOTE ───────────────────────────────────────────────────
    log.info('QUOTE', { seller: params.seller.orgId, price: quotePrice });
    const quote = this.sign<QuoteMessage>({
      bcp_version: '0.1',
      message_type: 'QUOTE',
      quote_id: uuidv4(),
      intent_id: intent.intent_id,
      timestamp: new Date().toISOString(),
      seller: {
        org_id: params.seller.orgId,
        agent_wallet_address: sellerAddr,
        credential: sellerAddr,
      },
      offer: {
        price: quotePrice,
        currency: 'USDC',
        payment_terms: terms,
        delivery_date: new Date(Date.now() + 14 * 86400_000).toISOString(),
        validity_until: new Date(Date.now() + 7 * 86400_000).toISOString(),
        line_items: [{
          description: params.item.description,
          qty: params.item.qty,
          unit_price: quotePrice / params.item.qty,
          unit: 'EA',
        }],
      },
    }, this.sellerEd25519.privateKey);
    sessionManager.processMessage(quote);

    // ── 3. COUNTER ─────────────────────────────────────────────────
    log.info('COUNTER', { proposed_price: finalPrice });
    const counter = this.sign<CounterMessage>({
      bcp_version: '0.1',
      message_type: 'COUNTER',
      counter_id: uuidv4(),
      ref_id: quote.quote_id,
      initiated_by: 'buyer',
      timestamp: new Date().toISOString(),
      proposed_changes: { price: finalPrice },
      rationale: `Counter: ${finalPrice} USDC`,
      new_validity_until: new Date(Date.now() + 3600_000).toISOString(),
    }, this.buyerEd25519.privateKey);
    sessionManager.processMessage(counter);

    // ── 4. Revised QUOTE (accept counter) ──────────────────────────
    log.info('QUOTE (accepted)', { price: finalPrice });
    const acceptedQuote = this.sign<QuoteMessage>({
      bcp_version: '0.1',
      message_type: 'QUOTE',
      quote_id: uuidv4(),
      intent_id: intent.intent_id,
      timestamp: new Date().toISOString(),
      seller: {
        org_id: params.seller.orgId,
        agent_wallet_address: sellerAddr,
        credential: sellerAddr,
      },
      offer: {
        price: finalPrice,
        currency: 'USDC',
        payment_terms: terms,
        delivery_date: new Date(Date.now() + 14 * 86400_000).toISOString(),
        validity_until: new Date(Date.now() + 7 * 86400_000).toISOString(),
        line_items: [{
          description: params.item.description,
          qty: params.item.qty,
          unit_price: finalPrice / params.item.qty,
          unit: 'EA',
        }],
      },
    }, this.sellerEd25519.privateKey);
    sessionManager.processMessage(acceptedQuote);

    // ── 5. COMMIT + escrow lock ────────────────────────────────────
    const dueDate = terms === 'immediate'
      ? new Date().toISOString()
      : new Date(Date.now() + 30 * 86400_000).toISOString();

    log.info('COMMIT', { amount: finalPrice, terms });
    const commit = this.sign<CommitMessage>({
      bcp_version: '0.1',
      message_type: 'COMMIT',
      commit_id: uuidv4(),
      accepted_ref_id: acceptedQuote.quote_id,
      timestamp: new Date().toISOString(),
      buyer_approval: {
        approved_by: buyerAddr,
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
    }, this.buyerEd25519.privateKey);

    const lockReceipt = await buyerEscrow.lock(commit);
    log.info('ESCROW LOCKED', { tx: lockReceipt.tx_hash });
    sessionManager.processMessage(commit);

    // Wait for block propagation before release
    await new Promise((r) => setTimeout(r, 4000));

    // ── 6. FULFIL + escrow release ─────────────────────────────────
    const invoiceId = `INV-${Date.now()}`;
    const invoiceResult = generateUBLInvoice(acceptedQuote, commit, {
      bcp_version: '0.1',
      message_type: 'FULFIL',
      fulfil_id: uuidv4(),
      commit_id: commit.commit_id,
      timestamp: new Date().toISOString(),
      delivery_proof: { type: 'service_confirmation', evidence: `Delivered: ${params.item.description}` },
      invoice: { format: 'UBL2.1', invoice_id: invoiceId, invoice_hash: '', invoice_url: '' },
      settlement_trigger: terms === 'immediate' ? 'immediate' : 'scheduled',
      signature: '',
    });

    const fulfil = this.sign<FulfilMessage>({
      bcp_version: '0.1',
      message_type: 'FULFIL',
      fulfil_id: uuidv4(),
      commit_id: commit.commit_id,
      timestamp: new Date().toISOString(),
      delivery_proof: {
        type: 'service_confirmation',
        evidence: `Delivered: ${params.item.description}`,
      },
      invoice: {
        format: 'UBL2.1',
        invoice_id: invoiceId,
        invoice_hash: invoiceResult.hash,
        invoice_url: `https://${params.seller.orgId}.example.com/invoices/${invoiceId}`,
      },
      settlement_trigger: terms === 'immediate' ? 'immediate' : 'scheduled',
    }, this.sellerEd25519.privateKey);

    const releaseReceipt = await sellerEscrow.release(fulfil);
    log.info('ESCROW RELEASED', { tx: releaseReceipt.tx_hash });
    sessionManager.processMessage(fulfil);

    // ── Build result ───────────────────────────────────────────────
    const session = sessionManager.getSession(intent.intent_id)!;
    const lockTx = lockReceipt.tx_hash || '';
    const releaseTx = releaseReceipt.tx_hash || '';

    return {
      lockTxHash: lockTx,
      releaseTxHash: releaseTx,
      lockUrl: this.explorerUrl ? `${this.explorerUrl}/tx/${lockTx}` : lockTx,
      releaseUrl: this.explorerUrl ? `${this.explorerUrl}/tx/${releaseTx}` : releaseTx,
      invoice: invoiceResult.xml,
      invoiceHash: invoiceResult.hash,
      contractAddress: this.contractAddress,
      price: finalPrice,
      currency: 'USDC',
      messageIds: [
        intent.intent_id,
        quote.quote_id,
        counter.counter_id,
        acceptedQuote.quote_id,
        commit.commit_id,
        fulfil.fulfil_id,
      ],
      state: session.state,
      messages: session.messages,
    };
  }

  /** Sign a BCP message with Ed25519. */
  private sign<T extends BCPMessage>(
    msg: Omit<T, 'signature'> & { signature?: string },
    privateKey: string
  ): T {
    const signature = signMessage(msg as unknown as Record<string, unknown>, privateKey);
    return { ...msg, signature } as unknown as T;
  }
}
