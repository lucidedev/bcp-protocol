/**
 * Example seller agent — BCP v0.3 lean message demo.
 *
 * Flow: Receive INTENT → Send QUOTE → Receive COUNTER → Send revised QUOTE →
 *       Receive COMMIT → Send FULFIL → Escrow released
 *
 * @module examples/seller-agent
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  IntentMessage,
  QuoteMessage,
  CounterMessage,
  FulfilMessage,
  CommitMessage,
} from '../src/messages/types';
import {
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
  markup: number;
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

  createQuote(intent: IntentMessage, unitPrice: number): QuoteMessage {
    const totalPrice = Math.round(unitPrice * (1 + this.config.markup / 100) * 100) / 100;

    const message: Omit<QuoteMessage, 'signature'> & { signature?: string } = {
      bcp_version: '0.3',
      type: 'quote',
      sessionId: intent.sessionId,
      timestamp: new Date().toISOString(),
      price: totalPrice,
      currency: intent.currency || 'USDC',
      deliverables: [intent.service],
      estimatedDays: 14,
      settlement: 'escrow',
      did: `did:key:${this.config.publicKey}`,
    };

    const signature = signMessage(
      message as unknown as Record<string, unknown>,
      this.config.privateKey
    );
    const signed: QuoteMessage = { ...message, signature } as QuoteMessage;

    log.info(`Sending QUOTE for ${intent.sessionId}`, { price: totalPrice, currency: intent.currency });

    this.sessionManager.processMessage(signed);
    return signed;
  }

  createCounterQuote(counter: CounterMessage, intent: IntentMessage, accepted: boolean = true): QuoteMessage {
    const price = accepted ? counter.counterPrice : Math.round(counter.counterPrice * 1.05 * 100) / 100;

    const message: Omit<QuoteMessage, 'signature'> & { signature?: string } = {
      bcp_version: '0.3',
      type: 'quote',
      sessionId: counter.sessionId,
      timestamp: new Date().toISOString(),
      price,
      currency: intent.currency || 'USDC',
      deliverables: [intent.service],
      estimatedDays: 14,
      settlement: 'escrow',
    };

    const signature = signMessage(
      message as unknown as Record<string, unknown>,
      this.config.privateKey
    );
    const signed: QuoteMessage = { ...message, signature } as QuoteMessage;

    log.info(`Sending revised QUOTE for ${counter.sessionId}`, { accepted, price });

    this.sessionManager.processMessage(signed);
    return signed;
  }

  async createFulfil(
    commit: CommitMessage, quote: QuoteMessage
  ): Promise<{ fulfil: FulfilMessage; invoiceXml: string }> {
    const tempFulfil: FulfilMessage = {
      bcp_version: '0.3',
      type: 'fulfil',
      sessionId: commit.sessionId,
      timestamp: new Date().toISOString(),
      summary: `Delivered: ${quote.deliverables?.join(', ') || 'service'}`,
      proofHash: '',
    };

    const invoiceResult = generateUBLInvoice(quote, commit, tempFulfil);

    const message: Omit<FulfilMessage, 'signature'> & { signature?: string } = {
      bcp_version: '0.3',
      type: 'fulfil',
      sessionId: commit.sessionId,
      timestamp: tempFulfil.timestamp,
      summary: tempFulfil.summary,
      proofHash: invoiceResult.hash,
      invoiceUrl: `https://${this.config.orgId}.example.com/invoices/${commit.sessionId}`,
    };

    const signature = signMessage(
      message as unknown as Record<string, unknown>,
      this.config.privateKey
    );
    const signed: FulfilMessage = { ...message, signature } as FulfilMessage;

    log.info(`Sending FULFIL for ${commit.sessionId}`, { invoiceHash: invoiceResult.hash.substring(0, 16) });

    const receipt = await this.escrow.release(signed);
    log.info(`Escrow released: ${receipt.tx_hash}`);

    this.sessionManager.processMessage(signed);
    return { fulfil: signed, invoiceXml: invoiceResult.xml };
  }
}

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
      markup: 15,
    },
    sessionManager,
    escrow
  );
}
