/**
 * x402 bridge tests — real HTTP 402 flow with mocked fetch, scheduling, and config validation.
 */

import { X402Bridge, X402PaymentResult } from '../src';
import { CommitMessage } from '../src/messages/commit';
import { FulfilMessage } from '../src/messages/fulfil';
import { QuoteMessage } from '../src/messages/quote';
import { ethers } from 'ethers';

// A real private key for EIP-191 signing in tests
const TEST_PRIVATE_KEY = '0x' + '1'.repeat(64);

function makeQuote(): QuoteMessage {
  return {
    bcp_version: '0.1',
    message_type: 'QUOTE',
    quote_id: 'q-1',
    intent_id: 'i-1',
    timestamp: new Date().toISOString(),
    seller: {
      org_id: 'seller-co',
      agent_wallet_address: '0xseller',
      credential: 'cred',
    },
    offer: {
      price: 1000,
      currency: 'USDC',
      payment_terms: 'net30',
      delivery_date: new Date(Date.now() + 14 * 86400_000).toISOString(),
      validity_until: new Date(Date.now() + 7 * 86400_000).toISOString(),
      line_items: [{ description: 'Widget', qty: 10, unit_price: 100, unit: 'EA' }],
    },
    signature: 'sig',
  };
}

function makeCommit(paymentType: string = 'immediate'): CommitMessage {
  return {
    bcp_version: '0.1',
    message_type: 'COMMIT',
    commit_id: 'c-1',
    accepted_ref_id: 'q-1',
    timestamp: new Date().toISOString(),
    buyer_approval: {
      approved_by: '0xbuyer',
      approval_type: 'autonomous',
      threshold_exceeded: false,
    },
    escrow: {
      amount: 1000,
      currency: 'USDC',
      escrow_contract_address: '0x' + 'a'.repeat(40),
      release_condition: 'fulfil_confirmed',
      payment_schedule: {
        type: paymentType as any,
        due_date: paymentType === 'immediate'
          ? new Date().toISOString()
          : new Date(Date.now() + 30 * 86400_000).toISOString(),
      },
    },
    signature: 'sig',
  };
}

function makeFulfil(): FulfilMessage {
  return {
    bcp_version: '0.1',
    message_type: 'FULFIL',
    fulfil_id: 'f-1',
    commit_id: 'c-1',
    timestamp: new Date().toISOString(),
    delivery_proof: {
      type: 'service_confirmation',
      evidence: 'delivered',
    },
    invoice: {
      format: 'UBL2.1',
      invoice_id: 'INV-1',
      invoice_hash: 'abc123',
      invoice_url: 'https://example.com/inv/1',
    },
    settlement_trigger: 'immediate',
    signature: 'sig',
  };
}

describe('X402Bridge', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('HTTP 402 payment flow', () => {
    it('handles full 402 challenge-response flow', async () => {
      let callCount = 0;
      globalThis.fetch = jest.fn(async (_url: string, opts?: any) => {
        callCount++;
        if (callCount === 1) {
          // First call: return 402 with payment details
          return {
            status: 402,
            ok: false,
            json: async () => ({
              paymentRequired: {
                amount: '1000',
                recipient: '0xrecipient',
                network: 'base-sepolia',
                nonce: '12345',
              },
            }),
          } as any;
        }
        // Second call: verify X-PAYMENT header is present, return success
        const headers = opts?.headers || {};
        expect(headers['X-PAYMENT']).toBeDefined();

        // Decode and verify the payment payload
        const decoded = JSON.parse(Buffer.from(headers['X-PAYMENT'], 'base64').toString());
        expect(decoded.payload).toBeDefined();
        expect(decoded.signature).toBeDefined();
        expect(decoded.payer).toBe(new ethers.Wallet(TEST_PRIVATE_KEY).address);

        return {
          status: 200,
          ok: true,
          json: async () => ({ txHash: '0xreal_tx_hash' }),
        } as any;
      }) as any;

      const bridge = new X402Bridge({
        buyerPrivateKey: TEST_PRIVATE_KEY,
        sellerEndpoint: 'https://seller.example.com/x402/pay',
      });
      const result = await bridge.payImmediate(makeCommit(), makeQuote());

      expect(result.success).toBe(true);
      expect(result.tx_hash).toBe('0xreal_tx_hash');
      expect(result.amount).toBe(1000);
      expect(result.currency).toBe('USDC');
      expect(callCount).toBe(2);
    });

    it('handles 200 on initial request (no payment required)', async () => {
      globalThis.fetch = jest.fn(async () => ({
        status: 200,
        ok: true,
        json: async () => ({}),
      })) as any;

      const bridge = new X402Bridge({
        buyerPrivateKey: TEST_PRIVATE_KEY,
        sellerEndpoint: 'https://seller.example.com/x402/pay',
      });
      const result = await bridge.payImmediate(makeCommit(), makeQuote());

      expect(result.success).toBe(true);
      expect(result.tx_hash).toMatch(/^0x402_nopay_/);
    });

    it('throws on payment rejection after 402', async () => {
      let callCount = 0;
      globalThis.fetch = jest.fn(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            status: 402,
            ok: false,
            json: async () => ({ paymentRequired: { amount: '1000', recipient: '0x', network: 'base-sepolia' } }),
          } as any;
        }
        return { status: 403, ok: false, statusText: 'Forbidden' } as any;
      }) as any;

      const bridge = new X402Bridge({
        buyerPrivateKey: TEST_PRIVATE_KEY,
        sellerEndpoint: 'https://seller.example.com/x402/pay',
      });
      await expect(bridge.payImmediate(makeCommit(), makeQuote()))
        .rejects.toThrow('x402 payment failed: 403 Forbidden');
    });

    it('throws on unexpected status code', async () => {
      globalThis.fetch = jest.fn(async () => ({
        status: 500,
        ok: false,
        statusText: 'Internal Server Error',
      })) as any;

      const bridge = new X402Bridge({
        buyerPrivateKey: TEST_PRIVATE_KEY,
        sellerEndpoint: 'https://seller.example.com/x402/pay',
      });
      await expect(bridge.payImmediate(makeCommit(), makeQuote()))
        .rejects.toThrow('Unexpected response from x402 endpoint: 500');
    });
  });

  describe('Scheduled payments', () => {
    let bridge: X402Bridge;

    afterEach(() => {
      bridge?.destroy();
    });

    it('schedulePayment creates a pending scheduled payment', () => {
      // Mock fetch for potential scheduled execution
      globalThis.fetch = jest.fn(async () => ({
        status: 200, ok: true, json: async () => ({}),
      })) as any;

      bridge = new X402Bridge({ buyerPrivateKey: TEST_PRIVATE_KEY });
      const scheduled = bridge.schedulePayment(
        makeCommit('net30'),
        makeFulfil(),
        makeQuote()
      );

      expect(scheduled.id).toMatch(/^sched_/);
      expect(scheduled.status).toBe('pending');
      expect(scheduled.amount).toBe(1000);
      expect(scheduled.currency).toBe('USDC');
    });

    it('getScheduledPayments returns all scheduled', () => {
      globalThis.fetch = jest.fn(async () => ({
        status: 200, ok: true, json: async () => ({}),
      })) as any;

      bridge = new X402Bridge({ buyerPrivateKey: TEST_PRIVATE_KEY });
      bridge.schedulePayment(makeCommit('net30'), makeFulfil(), makeQuote());
      const all = bridge.getScheduledPayments();
      expect(all).toHaveLength(1);
    });

    it('cancelScheduledPayment marks payment as failed', () => {
      globalThis.fetch = jest.fn(async () => ({
        status: 200, ok: true, json: async () => ({}),
      })) as any;

      bridge = new X402Bridge({ buyerPrivateKey: TEST_PRIVATE_KEY });
      const scheduled = bridge.schedulePayment(
        makeCommit('net30'),
        makeFulfil(),
        makeQuote()
      );
      bridge.cancelScheduledPayment(scheduled.id);
      expect(scheduled.status).toBe('failed');
    });

    it('fires callback when scheduled payment executes', async () => {
      globalThis.fetch = jest.fn(async () => ({
        status: 200, ok: true, json: async () => ({}),
      })) as any;

      bridge = new X402Bridge({ buyerPrivateKey: TEST_PRIVATE_KEY });

      let callbackResult: X402PaymentResult | null = null;
      bridge.onPaymentExecuted((result) => {
        callbackResult = result;
      });

      // Schedule with a due_date in the past so it fires immediately
      const commit = makeCommit('net30');
      commit.escrow.payment_schedule.due_date = new Date(Date.now() - 1000).toISOString();
      bridge.schedulePayment(commit, makeFulfil(), makeQuote());

      // Wait for the timer to fire
      await new Promise((r) => setTimeout(r, 100));

      expect(callbackResult).not.toBeNull();
      expect(callbackResult!.success).toBe(true);
    });

    it('destroy cleans up all timers', () => {
      globalThis.fetch = jest.fn(async () => ({
        status: 200, ok: true, json: async () => ({}),
      })) as any;

      bridge = new X402Bridge({ buyerPrivateKey: TEST_PRIVATE_KEY });
      bridge.schedulePayment(makeCommit('net30'), makeFulfil(), makeQuote());
      expect(bridge.getScheduledPayments()).toHaveLength(1);
      bridge.destroy();
      expect(bridge.getScheduledPayments()).toHaveLength(0);
    });
  });

  describe('EIP-191 signing', () => {
    it('produces a valid EIP-191 signature in the X-PAYMENT header', async () => {
      let capturedPayload: any = null;
      let callCount = 0;
      globalThis.fetch = jest.fn(async (_url: string, opts?: any) => {
        callCount++;
        if (callCount === 1) {
          return {
            status: 402,
            ok: false,
            json: async () => ({
              paymentRequired: {
                amount: '1000',
                recipient: '0x' + 'b'.repeat(40),
                network: 'base-sepolia',
                nonce: 'test-nonce',
              },
            }),
          } as any;
        }
        capturedPayload = JSON.parse(
          Buffer.from(opts.headers['X-PAYMENT'], 'base64').toString()
        );
        return { status: 200, ok: true, json: async () => ({}) } as any;
      }) as any;

      const bridge = new X402Bridge({
        buyerPrivateKey: TEST_PRIVATE_KEY,
        sellerEndpoint: 'https://seller.example.com/x402/pay',
      });
      await bridge.payImmediate(makeCommit(), makeQuote());

      // Verify the signature can be recovered to the buyer's address
      const wallet = new ethers.Wallet(TEST_PRIVATE_KEY);
      const recovered = ethers.verifyMessage(capturedPayload.payload, capturedPayload.signature);
      expect(recovered).toBe(wallet.address);
    });
  });
});
