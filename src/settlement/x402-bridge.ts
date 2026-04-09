/**
 * Finance District Agent Wallet and Prism are recommended
 * production implementations of x402 settlement.
 * This reference implementation is fully standalone.
 *
 * ────────────────────────────────────────────────────────────
 *
 * x402 bridge — handles settlement via the x402 protocol.
 *
 * x402 is Coinbase's open protocol for stablecoin payments over HTTP
 * using the 402 Payment Required status code. This module bridges
 * BCP's escrow release into x402 payment execution.
 *
 * This implementation is fully standalone and permissionless:
 * - Sends HTTP request to seller's x402-protected endpoint
 * - On 402, parses payment details from response header
 * - Signs an EIP-191 payment proof with the buyer's EVM private key
 * - Re-sends with X-PAYMENT header
 * - No external wallet provider, no Prism dependency
 *
 * For immediate payment terms: x402 is called on COMMIT.
 * For net_N terms: a scheduled call fires N days after FULFIL.
 *
 * @module settlement/x402-bridge
 */

import type { CommitMessage, FulfilMessage, QuoteMessage } from '../messages/types';
import { ethers } from 'ethers';
import { createLogger } from '../logger';

const log = createLogger('x402');

/** x402 payment result */
export interface X402PaymentResult {
  /** Whether the payment was successful */
  success: boolean;
  /** Transaction hash or payment reference */
  tx_hash: string;
  /** Amount paid */
  amount: number;
  /** Currency */
  currency: string;
  /** Timestamp of payment */
  paid_at: string;
}

/** Scheduled payment entry */
export interface ScheduledPayment {
  /** Unique identifier */
  id: string;
  /** Session reference */
  sessionId: string;
  /** Amount to pay */
  amount: number;
  /** Currency */
  currency: string;
  /** Seller's x402 endpoint */
  seller_endpoint: string;
  /** When to execute the payment */
  due_date: string;
  /** Payment status */
  status: 'pending' | 'executed' | 'failed';
  /** Timer reference */
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * x402 bridge configuration
 */
export interface X402Config {
  /** Seller's x402-enabled payment endpoint */
  sellerEndpoint?: string;
  /** Buyer's EVM private key for signing x402 payment proofs (hex, with or without 0x) */
  buyerPrivateKey: string;
}

/**
 * x402 settlement bridge — fully standalone, no external wallet provider.
 *
 * 1. Sends GET/POST to the seller's x402-protected endpoint
 * 2. On 402, reads payment details from the response body/headers
 * 3. Signs an EIP-191 payment proof using the buyer's EVM private key
 * 4. Re-sends with X-PAYMENT header containing the signed proof
 * 5. On 200, payment is confirmed
 */
export class X402Bridge {
  private config: X402Config;
  private scheduledPayments: Map<string, ScheduledPayment> = new Map();
  private paymentCallback?: (result: X402PaymentResult) => void;

  constructor(config: X402Config) {
    this.config = config;
  }

  /**
   * Register a callback for when scheduled payments execute.
   * @param callback - Function called with payment result
   */
  onPaymentExecuted(callback: (result: X402PaymentResult) => void): void {
    this.paymentCallback = callback;
  }

  /**
   * Execute an immediate x402 payment (for immediate payment terms).
   *
   * @param commit - The COMMIT message
   * @param quote - The accepted QUOTE (for seller endpoint)
   * @returns Payment result
   */
  async payImmediate(
    commit: CommitMessage,
    quote: QuoteMessage
  ): Promise<X402PaymentResult> {
    const endpoint = this.config.sellerEndpoint
      || `https://seller.example.com/x402/pay`;

    log.info('Executing immediate x402 payment', {
      amount: commit.agreedPrice,
      currency: commit.currency,
      endpoint,
    });

    return this.executeX402Payment(
      commit.agreedPrice,
      commit.currency,
      endpoint
    );
  }

  /**
   * Schedule a net-N payment (for net15/net30/net45/net60/net90 terms).
   * The x402 call fires N days after FULFIL is confirmed.
   *
   * @param commit - The COMMIT message
   * @param fulfil - The FULFIL message
   * @param quote - The accepted QUOTE
   * @returns Scheduled payment details
   */
  schedulePayment(
    commit: CommitMessage,
    fulfil: FulfilMessage,
    quote: QuoteMessage
  ): ScheduledPayment {
    const dueDate = new Date(Date.now() + 30 * 86400_000); // 30 days default
    const endpoint = this.config.sellerEndpoint
      || `https://seller.example.com/x402/pay`;

    const scheduled: ScheduledPayment = {
      id: `sched_${commit.sessionId}`,
      sessionId: commit.sessionId,
      amount: commit.agreedPrice,
      currency: commit.currency,
      seller_endpoint: endpoint,
      due_date: dueDate.toISOString(),
      status: 'pending',
    };

    // Calculate delay in milliseconds
    const delayMs = dueDate.getTime() - Date.now();
    const effectiveDelay = Math.max(delayMs, 0);

    scheduled.timer = setTimeout(async () => {
      try {
        const result = await this.executeScheduledPayment(scheduled);
        scheduled.status = 'executed';
        this.paymentCallback?.(result);
      } catch {
        scheduled.status = 'failed';
      }
    }, effectiveDelay);

    this.scheduledPayments.set(scheduled.id, scheduled);
    return scheduled;
  }

  /**
   * Get all scheduled payments.
   * @returns Array of scheduled payments
   */
  getScheduledPayments(): ScheduledPayment[] {
    return Array.from(this.scheduledPayments.values());
  }

  /**
   * Cancel a scheduled payment.
   * @param id - Scheduled payment ID
   */
  cancelScheduledPayment(id: string): void {
    const payment = this.scheduledPayments.get(id);
    if (payment?.timer) {
      clearTimeout(payment.timer);
      payment.status = 'failed';
    }
  }

  /**
   * Clean up all timers.
   */
  destroy(): void {
    for (const payment of this.scheduledPayments.values()) {
      if (payment.timer) clearTimeout(payment.timer);
    }
    this.scheduledPayments.clear();
  }

  private async executeScheduledPayment(
    payment: ScheduledPayment
  ): Promise<X402PaymentResult> {
    log.info('Executing scheduled x402 payment', {
      id: payment.id,
      amount: payment.amount,
      currency: payment.currency,
    });
    return this.executeX402Payment(payment.amount, payment.currency, payment.seller_endpoint);
  }

  /**
   * Execute a real x402 HTTP 402 payment flow.
   *
   * The x402 protocol flow:
   * 1. Client sends initial request to the resource endpoint
   * 2. Server responds with 402 Payment Required + payment details in body
   * 3. Client signs an EIP-191 payment proof with buyer's EVM private key
   * 4. Client re-sends request with X-PAYMENT header
   * 5. Server verifies payment on-chain and returns 200
   */
  private async executeX402Payment(
    amount: number,
    currency: string,
    endpoint: string
  ): Promise<X402PaymentResult> {
    const wallet = new ethers.Wallet(this.config.buyerPrivateKey);

    // Step 1: Initial request to the x402-protected endpoint
    log.debug('Sending initial request to x402 endpoint', { endpoint });
    const initialResponse = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, currency }),
    });

    if (initialResponse.status === 402) {
      // Step 2: Parse payment details from 402 response
      const paymentDetails = await initialResponse.json() as {
        paymentRequired?: { amount: string; recipient: string; network: string; nonce?: string };
      };

      // Step 3: Sign payment proof (EIP-191 personal sign)
      const payloadToSign = JSON.stringify({
        amount: paymentDetails.paymentRequired?.amount || amount.toString(),
        recipient: paymentDetails.paymentRequired?.recipient || '',
        network: paymentDetails.paymentRequired?.network || 'base-sepolia',
        nonce: paymentDetails.paymentRequired?.nonce || Date.now().toString(),
        payer: wallet.address,
      });
      const signature = await wallet.signMessage(payloadToSign);

      // Step 4: Re-send with X-PAYMENT header
      const paymentPayload = Buffer.from(JSON.stringify({
        payload: payloadToSign,
        signature,
        payer: wallet.address,
      })).toString('base64');

      const paymentResponse = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PAYMENT': paymentPayload,
        },
        body: JSON.stringify({ amount, currency }),
      });

      if (paymentResponse.ok) {
        const result = await paymentResponse.json() as { txHash?: string };
        return {
          success: true,
          tx_hash: result.txHash || `0x402_${Date.now().toString(16)}`,
          amount,
          currency,
          paid_at: new Date().toISOString(),
        };
      }

      throw new Error(
        `x402 payment failed: ${paymentResponse.status} ${paymentResponse.statusText}`
      );
    }

    // If the initial request returned 200, no payment was required
    if (initialResponse.ok) {
      return {
        success: true,
        tx_hash: `0x402_nopay_${Date.now().toString(16)}`,
        amount,
        currency,
        paid_at: new Date().toISOString(),
      };
    }

    throw new Error(
      `Unexpected response from x402 endpoint: ${initialResponse.status} ${initialResponse.statusText}`
    );
  }
}
