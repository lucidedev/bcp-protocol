/**
 * Example buyer agent — BCP v0.3 lean message demo.
 *
 * Flow: Send INTENT → Receive QUOTE → Send COUNTER → Receive QUOTE →
 *       Send COMMIT → Receive FULFIL → Escrow released
 *
 * @module examples/buyer-agent
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  IntentMessage,
  CounterMessage,
  CommitMessage,
  QuoteMessage,
} from '../src/messages/types';
import {
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
   */
  createIntent(service: string, budget: number): IntentMessage {
    const sessionId = uuidv4();
    const message: Omit<IntentMessage, 'signature'> & { signature?: string } = {
      bcp_version: '0.3',
      type: 'intent',
      sessionId,
      timestamp: new Date().toISOString(),
      service,
      budget,
      currency: this.config.currency,
      did: `did:key:${this.config.publicKey}`,
    };

    const signature = signMessage(
      message as unknown as Record<string, unknown>,
      this.config.privateKey
    );
    const signed: IntentMessage = { ...message, signature } as IntentMessage;

    log.info(`Sending INTENT: ${sessionId}`, { service, budget, currency: this.config.currency });

    this.sessionManager.processMessage(signed);
    return signed;
  }

  /**
   * Create a COUNTER message in response to a QUOTE.
   */
  createCounter(quote: QuoteMessage, counterPrice: number): CounterMessage {
    const message: Omit<CounterMessage, 'signature'> & { signature?: string } = {
      bcp_version: '0.3',
      type: 'counter',
      sessionId: quote.sessionId,
      timestamp: new Date().toISOString(),
      counterPrice,
      reason: `Counter-offer: requesting ${counterPrice} ${quote.currency}`,
    };

    const signature = signMessage(
      message as unknown as Record<string, unknown>,
      this.config.privateKey
    );
    const signed: CounterMessage = { ...message, signature } as CounterMessage;

    log.info(`Sending COUNTER on ${quote.sessionId}`, { counterPrice, originalPrice: quote.price });

    this.sessionManager.processMessage(signed);
    return signed;
  }

  /**
   * Create a COMMIT message accepting a QUOTE.
   */
  async createCommit(quote: QuoteMessage): Promise<CommitMessage> {
    const message: Omit<CommitMessage, 'signature'> & { signature?: string } = {
      bcp_version: '0.3',
      type: 'commit',
      sessionId: quote.sessionId,
      timestamp: new Date().toISOString(),
      agreedPrice: quote.price,
      currency: quote.currency,
      settlement: 'escrow',
      escrow: { contractAddress: this.config.escrowContractAddress },
    };

    const signature = signMessage(
      message as unknown as Record<string, unknown>,
      this.config.privateKey
    );
    const signed: CommitMessage = { ...message, signature } as CommitMessage;

    log.info(`Sending COMMIT on ${quote.sessionId}`, {
      agreedPrice: quote.price, currency: quote.currency,
    });

    const receipt = await this.escrow.lock(signed);
    log.info(`Escrow locked: ${receipt.escrow_id}`);

    this.sessionManager.processMessage(signed);
    return signed;
  }
}

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
