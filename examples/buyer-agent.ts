/**
 * Example buyer agent — demonstrates a complete BCP buyer flow.
 *
 * Flow: Send INTENT → Receive QUOTE → Send COUNTER → Receive QUOTE →
 *       Send COMMIT → Receive FULFIL → Escrow released → Invoice generated
 *
 * @module examples/buyer-agent
 */

import { v4 as uuidv4 } from 'uuid';
import {
  IntentMessage,
  CounterMessage,
  CommitMessage,
  QuoteMessage,
  SessionManager,
  signMessage,
  generateKeypair,
  EscrowProvider,
  createLogger,
} from '../src';

const log = createLogger('buyer');

/** Buyer agent configuration */
export interface BuyerAgentConfig {
  orgId: string;
  privateKey: string;
  publicKey: string;
  spendingLimit: number;
  currency: string;
  escrowContractAddress: string;
}

/**
 * BCP Buyer Agent — creates and sends buyer-side messages.
 */
export class BuyerAgent {
  public config: BuyerAgentConfig;
  private sessionManager: SessionManager;
  private escrow: EscrowProvider;

  constructor(config: BuyerAgentConfig, sessionManager: SessionManager, escrow: EscrowProvider) {
    this.config = config;
    this.sessionManager = sessionManager;
    this.escrow = escrow;
  }

  /**
   * Create and send an INTENT message.
   * @param category - Product/service category
   * @param quantity - Quantity needed
   * @param budgetMax - Maximum budget
   * @returns Signed INTENT message
   */
  createIntent(category: string, quantity: number, budgetMax: number): IntentMessage {
    const message: Omit<IntentMessage, 'signature'> & { signature?: string } = {
      bcp_version: '0.1',
      message_type: 'INTENT',
      intent_id: uuidv4(),
      timestamp: new Date().toISOString(),
      buyer: {
        org_id: this.config.orgId,
        agent_wallet_address: this.config.publicKey,
        credential: this.config.publicKey,
        spending_limit: this.config.spendingLimit,
        currency: this.config.currency,
      },
      requirements: {
        category,
        quantity,
        delivery_window: 'P14D',
        budget_max: budgetMax,
        payment_terms_acceptable: ['immediate', 'net30'],
        compliance: ['ISO27001'],
      },
      ttl: 3600,
    };

    const signature = signMessage(
      message as unknown as Record<string, unknown>,
      this.config.privateKey
    );
    const signed: IntentMessage = { ...message, signature } as IntentMessage;

    log.info(`Sending INTENT: ${signed.intent_id}`, {
      category,
      quantity,
      budget_max: budgetMax,
      currency: this.config.currency,
    });

    this.sessionManager.processMessage(signed);
    return signed;
  }

  /**
   * Create a COUNTER message in response to a QUOTE.
   * @param quote - The QUOTE being countered
   * @param newPrice - Proposed new price
   * @returns Signed COUNTER message
   */
  createCounter(quote: QuoteMessage, newPrice: number): CounterMessage {
    const message: Omit<CounterMessage, 'signature'> & { signature?: string } = {
      bcp_version: '0.1',
      message_type: 'COUNTER',
      counter_id: uuidv4(),
      ref_id: quote.quote_id,
      initiated_by: 'buyer',
      timestamp: new Date().toISOString(),
      proposed_changes: {
        price: newPrice,
      },
      rationale: `Counter-offer: requesting lower price of ${newPrice} ${quote.offer.currency}`,
      new_validity_until: new Date(Date.now() + 3600_000).toISOString(),
    };

    const signature = signMessage(
      message as unknown as Record<string, unknown>,
      this.config.privateKey
    );
    const signed: CounterMessage = { ...message, signature } as CounterMessage;

    log.info(`Sending COUNTER: ${signed.counter_id}`, {
      proposed_price: newPrice,
      original_price: quote.offer.price,
      currency: quote.offer.currency,
    });

    this.sessionManager.processMessage(signed);
    return signed;
  }

  /**
   * Create a COMMIT message accepting a QUOTE.
   * @param quote - The QUOTE being accepted
   * @returns Signed COMMIT message and escrow receipt
   */
  async createCommit(quote: QuoteMessage): Promise<CommitMessage> {
    const dueDate = quote.offer.payment_terms === 'immediate'
      ? new Date().toISOString()
      : new Date(Date.now() + this.getNetDays(quote.offer.payment_terms) * 86400_000).toISOString();

    const message: Omit<CommitMessage, 'signature'> & { signature?: string } = {
      bcp_version: '0.1',
      message_type: 'COMMIT',
      commit_id: uuidv4(),
      accepted_ref_id: quote.quote_id,
      timestamp: new Date().toISOString(),
      buyer_approval: {
        approved_by: this.config.publicKey,
        approval_type: quote.offer.price <= this.config.spendingLimit ? 'autonomous' : 'human_required',
        threshold_exceeded: quote.offer.price > this.config.spendingLimit,
      },
      escrow: {
        amount: quote.offer.price,
        currency: quote.offer.currency,
        escrow_contract_address: this.config.escrowContractAddress,
        release_condition: 'fulfil_confirmed',
        payment_schedule: {
          type: quote.offer.payment_terms,
          due_date: dueDate,
        },
      },
      po_reference: `PO-${Date.now()}`,
    };

    const signature = signMessage(
      message as unknown as Record<string, unknown>,
      this.config.privateKey
    );
    const signed: CommitMessage = { ...message, signature } as CommitMessage;

    log.info(`Sending COMMIT: ${signed.commit_id}`, {
      accepted_quote: quote.quote_id,
      escrow_amount: quote.offer.price,
      currency: quote.offer.currency,
      payment_terms: quote.offer.payment_terms,
    });

    // Lock escrow
    const receipt = await this.escrow.lock(signed);
    log.info(`Escrow locked: ${receipt.escrow_id}`);

    this.sessionManager.processMessage(signed);
    return signed;
  }

  private getNetDays(terms: string): number {
    const map: Record<string, number> = {
      immediate: 0, net15: 15, net30: 30, net45: 45, net60: 60, net90: 90,
    };
    return map[terms] ?? 30;
  }
}

/**
 * Create a buyer agent with a fresh keypair.
 * @param orgId - Organization ID
 * @param sessionManager - Shared session manager
 * @param escrow - Escrow provider
 * @returns Configured buyer agent
 */
export function createBuyerAgent(
  orgId: string,
  sessionManager: SessionManager,
  escrow: EscrowProvider,
  keys?: { privateKey: string; publicKey: string }
): BuyerAgent {
  const kp = keys || generateKeypair();
  return new BuyerAgent(
    {
      orgId,
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
      spendingLimit: 50000,
      currency: 'USDC',
      escrowContractAddress: process.env.BCP_ESCROW_CONTRACT_ADDRESS || '',
    },
    sessionManager,
    escrow
  );
}
