/**
 * BCP Seller SDK — the seller side of a B2B commerce session.
 *
 * Runs in the seller's process. Never requires the buyer's private key.
 * Listens for incoming BCP messages via an Express server.
 *
 * Usage:
 *   const seller = new BCPSeller({ network: 'base-sepolia' });
 *   seller.listen(3001);
 *   // Handles INTENT→QUOTE, COUNTER→revised QUOTE, COMMIT→FULFIL automatically
 *
 * @module seller
 */

import { v4 as uuidv4 } from 'uuid';
import { ethers } from 'ethers';
import { createBCPServer, MessageHandler } from './transport/server';
import { OnChainEscrowProvider } from './escrow/onchain-escrow';
import { generateKeypair, signMessage } from './validation/signature';
import { generateUBLInvoice } from './invoice/ubl-generator';
import { createLogger, configureLogger, LogLevel } from './logger';
import { SessionManager, BCPMessage } from './state/session';
import { IntentMessage, PaymentTerms } from './messages/intent';
import { CounterMessage } from './messages/counter';
import { CommitMessage } from './messages/commit';
import { QuoteMessage } from './messages/quote';
import { FulfilMessage } from './messages/fulfil';
import { DisputeMessage } from './messages/dispute';
import { NETWORKS, NetworkConfig, UnfreezeResult } from './buyer';

const log = createLogger('bcp-seller');

// ── Config ─────────────────────────────────────────────────────────

export interface BCPSellerConfig {
  /** Network name or custom RPC URL */
  network: string;
  /** Deployed BCPEscrow contract address */
  contractAddress?: string;
  /** Seller's EVM private key (hex) */
  evmPrivateKey?: string;
  /** Pre-generated Ed25519 keys */
  ed25519?: { privateKey: string; publicKey: string };
  /** Log level */
  logLevel?: LogLevel;
  /** Custom token address */
  tokenAddress?: string;
  /** Token decimals */
  tokenDecimals?: number;
}

/** Pricing callback: given an INTENT, return unit price and line items */
export type PricingStrategy = (intent: IntentMessage) => {
  unitPrice: number;
  description?: string;
};

export interface SellerListenOptions {
  /** Port to listen on (default: 3001) */
  port?: number;
  /** Organization ID for QUOTE messages */
  orgId?: string;
  /** Pricing strategy: given an INTENT, return the price */
  pricing?: PricingStrategy;
  /** Default markup percentage if no pricing strategy (default: 15) */
  markupPercent?: number;
  /** Whether to auto-accept counter-offers (default: true) */
  autoAcceptCounters?: boolean;
  /** Callback when a deal completes */
  onDealComplete?: (result: SellerDealResult) => void;
  /** Callback when a DISPUTE is received. The escrow has been frozen by the buyer. */
  onDisputeReceived?: (dispute: DisputeMessage) => void;
}

export interface SellerDealResult {
  commitId: string;
  releaseTxHash: string;
  releaseUrl: string;
  price: number;
  currency: string;
  invoiceId: string;
  buyerOrgId: string;
}

// ── Seller SDK ─────────────────────────────────────────────────────

export class BCPSeller {
  private networkConfig: NetworkConfig;
  private contractAddress: string;
  private evmKey: string;
  private ed25519: { privateKey: string; publicKey: string };
  private explorerUrl: string;
  private tokenAddress: string;
  private tokenDecimals: number;

  constructor(config: BCPSellerConfig) {
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

    this.evmKey = config.evmPrivateKey || process.env.SELLER_EVM_PRIVATE_KEY || '';
    if (!this.evmKey) throw new Error('Missing seller EVM key. Set SELLER_EVM_PRIVATE_KEY or pass evmPrivateKey.');

    this.contractAddress = config.contractAddress || process.env.BCP_ESCROW_CONTRACT_ADDRESS || '';
    if (!this.contractAddress) throw new Error('Missing escrow contract address.');

    this.tokenAddress = config.tokenAddress || this.networkConfig.usdcAddress;
    this.tokenDecimals = config.tokenDecimals ?? this.networkConfig.usdcDecimals;
    this.explorerUrl = this.networkConfig.explorerUrl;

    this.ed25519 = config.ed25519 || (() => {
      const pk = process.env.SELLER_ED25519_PRIVATE_KEY;
      const pub = process.env.SELLER_ED25519_PUBLIC_KEY;
      return pk && pub ? { privateKey: pk, publicKey: pub } : generateKeypair();
    })();

    configureLogger({ level: config.logLevel ?? LogLevel.INFO });
    log.info('BCPSeller initialized', {
      network: config.network,
      contract: this.contractAddress,
      address: new ethers.Wallet(this.evmKey).address,
    });
  }

  /** Get the seller's EVM address */
  get address(): string {
    return new ethers.Wallet(this.evmKey).address;
  }

  /** Get the seller's public Ed25519 key */
  get publicKey(): string {
    return this.ed25519.publicKey;
  }

  /**
   * Start listening for incoming BCP messages.
   * Automatically handles: INTENT→QUOTE, COUNTER→revised QUOTE, COMMIT→FULFIL.
   */
  listen(options: SellerListenOptions | number = {}): void {
    const opts: SellerListenOptions = typeof options === 'number' ? { port: options } : options;
    const port = opts.port || 3001;
    const orgId = opts.orgId || 'SellerCorp';
    const markupPercent = opts.markupPercent ?? 15;
    const autoAcceptCounters = opts.autoAcceptCounters ?? true;

    const sessionManager = new SessionManager();
    const publicKeyMap = new Map<string, string>();

    const server = createBCPServer(sessionManager, {
      port,
      resolvePublicKey: (addr) => publicKeyMap.get(addr) || addr,
      disableTimestampCheck: true,     // TODO: re-enable in production
      disableReplayProtection: true,   // TODO: re-enable in production
    });

    // Track buyer public keys for signature verification
    const registerBuyerKey = (msg: BCPMessage) => {
      const m = msg as unknown as Record<string, unknown>;
      const buyer = m.buyer as Record<string, unknown> | undefined;
      if (buyer?.agent_wallet_address) {
        publicKeyMap.set(buyer.agent_wallet_address as string, buyer.agent_wallet_address as string);
      }
    };

    // Prices negotiated per intent
    const priceMap = new Map<string, number>();
    // Track buyer EVM addresses from COMMIT for escrow
    const buyerEvmMap = new Map<string, string>();

    // ── INTENT handler → respond with QUOTE ─────────────────────────
    const onMessage = (server as unknown as Record<string, (type: string, handler: MessageHandler) => void>).onMessage;

    onMessage('INTENT', async (msg: BCPMessage): Promise<BCPMessage | null> => {
      const intent = msg as IntentMessage;
      registerBuyerKey(msg);

      let unitPrice: number;
      let description = intent.requirements.category;

      if (opts.pricing) {
        const result = opts.pricing(intent);
        unitPrice = result.unitPrice;
        if (result.description) description = result.description;
      } else {
        // Default: use budget_max with markup
        const budgetHint = intent.requirements.budget_max || 10;
        unitPrice = Math.round(budgetHint * (1 + markupPercent / 100) / intent.requirements.quantity * 100) / 100;
      }

      const totalPrice = Math.round(unitPrice * intent.requirements.quantity * 100) / 100;
      priceMap.set(intent.intent_id, totalPrice);

      log.info('← INTENT received, sending QUOTE', {
        buyer: intent.buyer.org_id,
        item: description,
        price: totalPrice,
      });

      const quote: QuoteMessage = {
        bcp_version: '0.1',
        message_type: 'QUOTE',
        quote_id: uuidv4(),
        intent_id: intent.intent_id,
        timestamp: new Date().toISOString(),
        seller: {
          org_id: orgId,
          agent_wallet_address: this.ed25519.publicKey,
          credential: this.ed25519.publicKey,
          evm_address: this.address,
        },
        offer: {
          price: totalPrice,
          currency: 'USDC',
          payment_terms: (intent.requirements.payment_terms_acceptable[0] as PaymentTerms) || 'immediate',
          delivery_date: new Date(Date.now() + 14 * 86400_000).toISOString(),
          validity_until: new Date(Date.now() + 7 * 86400_000).toISOString(),
          line_items: [{
            description,
            qty: intent.requirements.quantity,
            unit_price: unitPrice,
            unit: 'EA',
          }],
        },
        signature: '',
      };

      const sig = signMessage(quote as unknown as Record<string, unknown>, this.ed25519.privateKey);
      return { ...quote, signature: sig } as unknown as BCPMessage;
    });

    // ── COUNTER handler → respond with revised QUOTE ────────────────
    onMessage('COUNTER', async (msg: BCPMessage): Promise<BCPMessage | null> => {
      const counter = msg as CounterMessage;

      if (!autoAcceptCounters) {
        log.info('← COUNTER received (not auto-accepting)', { proposed: counter.proposed_changes });
        return null;
      }

      const proposedPrice = counter.proposed_changes.price;
      if (proposedPrice === undefined) {
        log.info('← COUNTER received (no price change)');
        return null;
      }

      log.info('← COUNTER received, accepting', { proposed: proposedPrice });

      // Find the intent_id via the session
      const sessions = sessionManager.getAllSessions();
      const session = sessions.find(s => s.lastOfferId === counter.ref_id);
      if (!session) return null;

      priceMap.set(session.intentId, proposedPrice);

      const revisedQuote: QuoteMessage = {
        bcp_version: '0.1',
        message_type: 'QUOTE',
        quote_id: uuidv4(),
        intent_id: session.intentId,
        timestamp: new Date().toISOString(),
        seller: {
          org_id: orgId,
          agent_wallet_address: this.ed25519.publicKey,
          credential: this.ed25519.publicKey,
          evm_address: this.address,
        },
        offer: {
          price: proposedPrice,
          currency: 'USDC',
          payment_terms: 'immediate',
          delivery_date: new Date(Date.now() + 14 * 86400_000).toISOString(),
          validity_until: new Date(Date.now() + 7 * 86400_000).toISOString(),
          line_items: [{
            description: session.messages[0]
              ? ((session.messages[0] as unknown as Record<string, unknown>).requirements as Record<string, unknown>)?.category as string || 'Item'
              : 'Item',
            qty: 1,
            unit_price: proposedPrice,
            unit: 'EA',
          }],
        },
        signature: '',
      };

      const sig = signMessage(revisedQuote as unknown as Record<string, unknown>, this.ed25519.privateKey);
      return { ...revisedQuote, signature: sig } as unknown as BCPMessage;
    });

    // ── COMMIT handler → release escrow + respond with FULFIL ───────
    onMessage('COMMIT', async (msg: BCPMessage): Promise<BCPMessage | null> => {
      const commit = msg as CommitMessage;

      log.info('← COMMIT received, releasing escrow', {
        commitId: commit.commit_id,
        amount: commit.escrow.amount,
      });

      // Find buyer EVM address from headers or env
      const buyerAddr = process.env.BUYER_EVM_ADDRESS || '';
      if (!buyerAddr) {
        log.warn('BUYER_EVM_ADDRESS not set, cannot verify escrow counterparty');
      }

      const escrow = OnChainEscrowProvider.createSellerInstance({
        rpcUrl: this.networkConfig.rpcUrl,
        contractAddress: this.contractAddress,
        sellerPrivateKey: this.evmKey,
        buyerAddress: buyerAddr,
        tokenAddress: this.tokenAddress,
        tokenDecimals: this.tokenDecimals,
      });

      // Wait for lock confirmation to propagate
      await new Promise(r => setTimeout(r, 4000));

      const releaseReceipt = await escrow.release({
        bcp_version: '0.1',
        message_type: 'FULFIL',
        fulfil_id: uuidv4(),
        commit_id: commit.commit_id,
        timestamp: new Date().toISOString(),
        delivery_proof: { type: 'service_confirmation', evidence: 'Delivery confirmed' },
        invoice: { format: 'UBL2.1', invoice_id: '', invoice_hash: '', invoice_url: '' },
        settlement_trigger: 'immediate',
        signature: '',
      });

      log.info('✓ ESCROW RELEASED', { tx: releaseReceipt.tx_hash });

      // Find the intent and accepted quote for invoice generation
      const sessions = sessionManager.getAllSessions();
      const session = sessions.find(s => s.commitId === commit.commit_id);
      const intentId = session?.intentId || '';

      // Generate invoice
      const invoiceId = `INV-${Date.now()}`;
      const lastQuote = session?.messages.filter(m => m.message_type === 'QUOTE').pop() as QuoteMessage | undefined;

      let invoiceXml = '';
      let invoiceHash = '';
      if (lastQuote) {
        const result = generateUBLInvoice(lastQuote, commit, {
          bcp_version: '0.1',
          message_type: 'FULFIL',
          fulfil_id: uuidv4(),
          commit_id: commit.commit_id,
          timestamp: new Date().toISOString(),
          delivery_proof: { type: 'service_confirmation', evidence: 'Delivered' },
          invoice: { format: 'UBL2.1', invoice_id: invoiceId, invoice_hash: '', invoice_url: '' },
          settlement_trigger: 'immediate',
          signature: '',
        });
        invoiceXml = result.xml;
        invoiceHash = result.hash;
      }

      const fulfil: FulfilMessage = {
        bcp_version: '0.1',
        message_type: 'FULFIL',
        fulfil_id: uuidv4(),
        commit_id: commit.commit_id,
        timestamp: new Date().toISOString(),
        delivery_proof: {
          type: 'service_confirmation',
          evidence: 'Service delivered and confirmed',
        },
        invoice: {
          format: 'UBL2.1',
          invoice_id: invoiceId,
          invoice_hash: invoiceHash,
          invoice_url: `https://${orgId}.example.com/invoices/${invoiceId}`,
        },
        settlement_trigger: 'immediate',
        release_tx_hash: releaseReceipt.tx_hash,
        signature: '',
      };

      const sig = signMessage(fulfil as unknown as Record<string, unknown>, this.ed25519.privateKey);
      const signedFulfil = { ...fulfil, signature: sig };

      if (opts.onDealComplete) {
        opts.onDealComplete({
          commitId: commit.commit_id,
          releaseTxHash: releaseReceipt.tx_hash,
          releaseUrl: this.explorerUrl ? `${this.explorerUrl}/tx/${releaseReceipt.tx_hash}` : '',
          price: commit.escrow.amount,
          currency: commit.escrow.currency,
          invoiceId,
          buyerOrgId: (session?.messages[0] as unknown as Record<string, unknown>)?.buyer
            ? ((session!.messages[0] as unknown as Record<string, unknown>).buyer as Record<string, unknown>).org_id as string
            : 'Unknown',
        });
      }

      return signedFulfil as unknown as BCPMessage;
    });

    // ── DISPUTE handler → acknowledge and notify ────────────────────
    onMessage('DISPUTE', async (msg: BCPMessage): Promise<BCPMessage | null> => {
      const dispute = msg as DisputeMessage;
      log.warn('← DISPUTE received', {
        commitId: dispute.commit_id,
        reason: dispute.reason,
        raisedBy: dispute.raised_by,
        requestedResolution: dispute.requested_resolution,
      });

      if (opts.onDisputeReceived) {
        opts.onDisputeReceived(dispute);
      }

      // No response message — disputes are acknowledged via the escrow layer
      return null;
    });

    server.listen(port, () => {
      log.info(`BCPSeller listening on port ${port}`, {
        address: this.address,
        org: orgId,
      });
    });
  }

  /**
   * Approve unfreezing a disputed escrow. Both buyer and seller must call
   * this before the escrow returns to Locked state on-chain.
   */
  async approveUnfreeze(commitId: string): Promise<UnfreezeResult> {
    const buyerAddr = process.env.BUYER_EVM_ADDRESS || '';
    const escrow = OnChainEscrowProvider.createSellerInstance({
      rpcUrl: this.networkConfig.rpcUrl,
      contractAddress: this.contractAddress,
      sellerPrivateKey: this.evmKey,
      buyerAddress: buyerAddr,
      tokenAddress: this.tokenAddress,
      tokenDecimals: this.tokenDecimals,
    });

    log.info('→ approveUnfreeze (seller)', { commitId });
    const approval = await escrow.approveUnfreeze(commitId);
    log.info('✓ Unfreeze approved', { tx: approval.tx_hash, fullyUnfrozen: approval.fully_unfrozen });

    return {
      commitId,
      approvalTxHash: approval.tx_hash,
      approvalUrl: this.explorerUrl ? `${this.explorerUrl}/tx/${approval.tx_hash}` : '',
      fullyUnfrozen: approval.fully_unfrozen,
    };
  }
}
