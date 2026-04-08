/**
 * Example seller agent — demonstrates a complete BCP seller flow.
 *
 * Flow: Receive INTENT → Send QUOTE → Receive COUNTER → Send new QUOTE →
 *       Receive COMMIT → Send FULFIL → Escrow released
 *
 * @module examples/seller-agent
 */

import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import {
  IntentMessage,
  QuoteMessage,
  CounterMessage,
  FulfilMessage,
  CommitMessage,
  SessionManager,
  signMessage,
  generateKeypair,
  EscrowProvider,
  generateUBLInvoice,
  createLogger,
} from '../src';

const log = createLogger('seller');

/** Seller agent configuration */
export interface SellerAgentConfig {
  orgId: string;
  privateKey: string;
  publicKey: string;
  markup: number; // percentage markup over base cost
}

/**
 * BCP Seller Agent — creates and sends seller-side messages.
 */
export class SellerAgent {
  public config: SellerAgentConfig;
  private sessionManager: SessionManager;
  private escrow: EscrowProvider;

  constructor(config: SellerAgentConfig, sessionManager: SessionManager, escrow: EscrowProvider) {
    this.config = config;
    this.sessionManager = sessionManager;
    this.escrow = escrow;
  }

  /**
   * Create a QUOTE in response to an INTENT.
   * @param intent - The INTENT message
   * @param unitPrice - Price per unit
   * @returns Signed QUOTE message
   */
  createQuote(intent: IntentMessage, unitPrice: number): QuoteMessage {
    const totalPrice = intent.requirements.quantity * unitPrice * (1 + this.config.markup / 100);
    const roundedPrice = Math.round(totalPrice * 100) / 100;

    const message: Omit<QuoteMessage, 'signature'> & { signature?: string } = {
      bcp_version: '0.1',
      message_type: 'QUOTE',
      quote_id: uuidv4(),
      intent_id: intent.intent_id,
      timestamp: new Date().toISOString(),
      seller: {
        org_id: this.config.orgId,
        agent_wallet_address: this.config.publicKey,
        credential: this.config.publicKey,
      },
      offer: {
        price: roundedPrice,
        currency: intent.buyer.currency,
        payment_terms: 'net30',
        delivery_date: new Date(Date.now() + 14 * 86400_000).toISOString(),
        validity_until: new Date(Date.now() + 7 * 86400_000).toISOString(),
        line_items: [
          {
            description: `${intent.requirements.category} - standard`,
            qty: intent.requirements.quantity,
            unit_price: unitPrice * (1 + this.config.markup / 100),
            unit: 'EA',
          },
        ],
        early_pay_discount: {
          discount_percent: 2.0,
          if_paid_within_days: 10,
        },
      },
    };

    const signature = signMessage(
      message as unknown as Record<string, unknown>,
      this.config.privateKey
    );
    const signed: QuoteMessage = { ...message, signature } as QuoteMessage;

    log.info(`Sending QUOTE: ${signed.quote_id}`, {
      price: roundedPrice,
      currency: intent.buyer.currency,
      terms: 'net30',
      early_pay_discount: '2% within 10 days',
    });

    this.sessionManager.processMessage(signed);
    return signed;
  }

  /**
   * Create a new QUOTE accepting a buyer's counter-offer (possibly with adjustments).
   * @param counter - The COUNTER message from the buyer
   * @param intent - The original INTENT
   * @param accepted - Whether to accept the counter price as-is
   * @returns Signed QUOTE message
   */
  createCounterQuote(
    counter: CounterMessage,
    intent: IntentMessage,
    accepted: boolean = true
  ): QuoteMessage {
    const price = accepted && counter.proposed_changes.price
      ? counter.proposed_changes.price
      : (counter.proposed_changes.price || 0) * 1.05; // 5% above counter if not accepting

    const message: Omit<QuoteMessage, 'signature'> & { signature?: string } = {
      bcp_version: '0.1',
      message_type: 'QUOTE',
      quote_id: uuidv4(),
      intent_id: intent.intent_id,
      timestamp: new Date().toISOString(),
      seller: {
        org_id: this.config.orgId,
        agent_wallet_address: this.config.publicKey,
        credential: this.config.publicKey,
      },
      offer: {
        price: Math.round(price * 100) / 100,
        currency: intent.buyer.currency,
        payment_terms: counter.proposed_changes.payment_terms || 'net30',
        delivery_date: counter.proposed_changes.delivery_date
          || new Date(Date.now() + 14 * 86400_000).toISOString(),
        validity_until: new Date(Date.now() + 7 * 86400_000).toISOString(),
        line_items: counter.proposed_changes.line_items || [
          {
            description: `${intent.requirements.category} - standard`,
            qty: intent.requirements.quantity,
            unit_price: Math.round((price / intent.requirements.quantity) * 100) / 100,
            unit: 'EA',
          },
        ],
      },
    };

    const signature = signMessage(
      message as unknown as Record<string, unknown>,
      this.config.privateKey
    );
    const signed: QuoteMessage = { ...message, signature } as QuoteMessage;

    log.info(`Sending revised QUOTE: ${signed.quote_id}`, {
      status: accepted ? 'accepted' : 'adjusted',
      price: signed.offer.price,
      currency: intent.buyer.currency,
    });

    this.sessionManager.processMessage(signed);
    return signed;
  }

  /**
   * Create a FULFIL message after delivery.
   * @param commit - The COMMIT message
   * @param quote - The accepted QUOTE (for invoice generation)
   * @returns Signed FULFIL message and generated UBL invoice
   */
  async createFulfil(
    commit: CommitMessage,
    quote: QuoteMessage
  ): Promise<{ fulfil: FulfilMessage; invoiceXml: string }> {
    const invoiceId = `INV-${Date.now()}`;

    // Build a temporary fulfil to generate the invoice
    const tempFulfil: FulfilMessage = {
      bcp_version: '0.1',
      message_type: 'FULFIL',
      fulfil_id: uuidv4(),
      commit_id: commit.commit_id,
      timestamp: new Date().toISOString(),
      delivery_proof: {
        type: 'service_confirmation',
        evidence: `Delivery confirmed for commit ${commit.commit_id}`,
      },
      invoice: {
        format: 'UBL2.1',
        invoice_id: invoiceId,
        invoice_hash: '', // Will be filled after generation
        invoice_url: `https://${this.config.orgId}.example.com/invoices/${invoiceId}`,
      },
      settlement_trigger: commit.escrow.payment_schedule.type === 'immediate' ? 'immediate' : 'scheduled',
      signature: '', // Will be signed
    };

    // Generate UBL invoice
    const invoiceResult = generateUBLInvoice(quote, commit, tempFulfil);

    // Build the actual fulfil message with correct hash
    const message: Omit<FulfilMessage, 'signature'> & { signature?: string } = {
      bcp_version: '0.1',
      message_type: 'FULFIL',
      fulfil_id: tempFulfil.fulfil_id,
      commit_id: commit.commit_id,
      timestamp: tempFulfil.timestamp,
      delivery_proof: tempFulfil.delivery_proof,
      invoice: {
        format: 'UBL2.1',
        invoice_id: invoiceId,
        invoice_hash: invoiceResult.hash,
        invoice_url: tempFulfil.invoice.invoice_url,
      },
      settlement_trigger: tempFulfil.settlement_trigger,
    };

    const signature = signMessage(
      message as unknown as Record<string, unknown>,
      this.config.privateKey
    );
    const signed: FulfilMessage = { ...message, signature } as FulfilMessage;

    log.info(`Sending FULFIL: ${signed.fulfil_id}`, {
      invoice_id: invoiceId,
      invoice_hash: invoiceResult.hash.substring(0, 16),
      settlement: signed.settlement_trigger,
    });

    // Release escrow
    const receipt = await this.escrow.release(signed);
    log.info(`Escrow released: ${receipt.tx_hash}`);

    this.sessionManager.processMessage(signed);
    return { fulfil: signed, invoiceXml: invoiceResult.xml };
  }
}

/**
 * Create a seller agent with a fresh keypair.
 * @param orgId - Organization ID
 * @param sessionManager - Shared session manager
 * @param escrow - Escrow provider
 * @returns Configured seller agent
 */
export function createSellerAgent(
  orgId: string,
  sessionManager: SessionManager,
  escrow: EscrowProvider,
  keys?: { privateKey: string; publicKey: string }
): SellerAgent {
  const kp = keys || generateKeypair();
  return new SellerAgent(
    {
      orgId,
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
      markup: 15, // 15% markup
    },
    sessionManager,
    escrow
  );
}
