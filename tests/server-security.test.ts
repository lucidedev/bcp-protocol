/**
 * Server security tests — covers all 4 security enforcements:
 * 1. Mandatory signature verification
 * 2. Timestamp / TTL freshness
 * 3. Replay protection
 * 4. Spending limit enforcement on COMMIT
 */

import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import {
  createBCPServer,
  SessionManager,
  generateKeypair,
  signMessage,
} from '../src';

// Keypairs for test buyer/seller
const buyerKeys = generateKeypair();
const sellerKeys = generateKeypair();

// Public key resolver
const keyMap = new Map<string, string>();
keyMap.set(buyerKeys.publicKey, buyerKeys.publicKey);
keyMap.set(sellerKeys.publicKey, sellerKeys.publicKey);

function resolvePublicKey(walletAddress: string): string | undefined {
  return keyMap.get(walletAddress);
}

/** Build a valid signed INTENT for testing */
function makeSignedIntent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const msg: Record<string, unknown> = {
    bcp_version: '0.1',
    message_type: 'INTENT',
    intent_id: uuidv4(),
    timestamp: new Date().toISOString(),
    buyer: {
      org_id: 'test-buyer',
      agent_wallet_address: buyerKeys.publicKey,
      credential: buyerKeys.publicKey,
      spending_limit: 50000,
      currency: 'USDC',
    },
    requirements: {
      category: 'Test Items',
      quantity: 10,
      delivery_window: 'P14D',
      budget_max: 10000,
      payment_terms_acceptable: ['immediate', 'net30'],
    },
    ttl: 3600,
    ...overrides,
  };
  const signature = signMessage(msg, buyerKeys.privateKey);
  return { ...msg, signature };
}

/** Build a valid signed QUOTE for testing */
function makeSignedQuote(intentId: string, quoteId?: string): Record<string, unknown> {
  const msg: Record<string, unknown> = {
    bcp_version: '0.1',
    message_type: 'QUOTE',
    quote_id: quoteId || uuidv4(),
    intent_id: intentId,
    timestamp: new Date().toISOString(),
    seller: {
      org_id: 'test-seller',
      agent_wallet_address: sellerKeys.publicKey,
      credential: sellerKeys.publicKey,
    },
    offer: {
      price: 5000,
      currency: 'USDC',
      payment_terms: 'net30',
      delivery_date: new Date(Date.now() + 14 * 86400_000).toISOString(),
      validity_until: new Date(Date.now() + 7 * 86400_000).toISOString(),
      line_items: [{ description: 'Test', qty: 10, unit_price: 500, unit: 'EA' }],
    },
  };
  const signature = signMessage(msg, sellerKeys.privateKey);
  return { ...msg, signature };
}

/** Build a valid signed COMMIT for testing */
function makeSignedCommit(
  quoteId: string,
  amount: number,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const msg: Record<string, unknown> = {
    bcp_version: '0.1',
    message_type: 'COMMIT',
    commit_id: uuidv4(),
    accepted_ref_id: quoteId,
    timestamp: new Date().toISOString(),
    buyer_approval: {
      approved_by: buyerKeys.publicKey,
      approval_type: 'autonomous',
      threshold_exceeded: false,
    },
    escrow: {
      amount,
      currency: 'USDC',
      escrow_contract_address: '0x' + 'a'.repeat(40),
      release_condition: 'fulfil_confirmed',
      payment_schedule: {
        type: 'net30',
        due_date: new Date(Date.now() + 30 * 86400_000).toISOString(),
      },
    },
    ...overrides,
  };
  const signature = signMessage(msg, buyerKeys.privateKey);
  return { ...msg, signature };
}

describe('Server Security', () => {
  // ── 1. Signature verification ─────────────────────────────────────
  describe('Mandatory signature verification', () => {
    it('rejects messages when no resolvePublicKey configured (fail-closed)', async () => {
      const sm = new SessionManager();
      const app = createBCPServer(sm, {
        disableTimestampCheck: true,
        disableReplayProtection: true,
        // NO resolvePublicKey
      });
      const intent = makeSignedIntent();

      const res = await request(app)
        .post('/bcp/intent')
        .send(intent);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('BCP_001');
    });

    it('rejects messages with unknown wallet address', async () => {
      const sm = new SessionManager();
      const unknownKeys = generateKeypair();
      const app = createBCPServer(sm, {
        resolvePublicKey: (addr) => keyMap.get(addr),
        disableTimestampCheck: true,
        disableReplayProtection: true,
      });
      const intent = makeSignedIntent({
        buyer: {
          org_id: 'unknown',
          agent_wallet_address: unknownKeys.publicKey,
          credential: unknownKeys.publicKey,
          spending_limit: 50000,
          currency: 'USDC',
        },
      });
      // Re-sign with the unknown key
      const { signature: _, ...rest } = intent;
      const sig = signMessage(rest, unknownKeys.privateKey);
      const signed = { ...rest, signature: sig };

      const res = await request(app)
        .post('/bcp/intent')
        .send(signed);

      expect(res.status).toBe(403);
      expect(res.body.error.message).toMatch(/Unknown wallet address/);
    });

    it('rejects messages with invalid signature', async () => {
      const sm = new SessionManager();
      const app = createBCPServer(sm, {
        resolvePublicKey,
        disableTimestampCheck: true,
        disableReplayProtection: true,
      });
      const intent = makeSignedIntent();
      // Tamper with the signature
      (intent as Record<string, unknown>).signature = 'bad' + (intent.signature as string).slice(3);

      const res = await request(app)
        .post('/bcp/intent')
        .send(intent);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('BCP_001');
    });

    it('accepts messages with valid signature', async () => {
      const sm = new SessionManager();
      const app = createBCPServer(sm, {
        resolvePublicKey,
        disableTimestampCheck: true,
        disableReplayProtection: true,
      });
      const intent = makeSignedIntent();

      const res = await request(app)
        .post('/bcp/intent')
        .send(intent);

      expect(res.status).toBe(200);
      expect(res.body.accepted).toBe(true);
    });
  });

  // ── 2. Timestamp / TTL freshness ──────────────────────────────────
  describe('Timestamp validation', () => {
    it('rejects messages older than maxAgeSec', async () => {
      const sm = new SessionManager();
      const app = createBCPServer(sm, {
        resolvePublicKey,
        maxAgeSec: 60,
        disableReplayProtection: true,
      });
      // Message timestamped 5 minutes ago
      const oldTimestamp = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const intent = makeSignedIntent({ timestamp: oldTimestamp });
      // Re-sign because timestamp changed
      const { signature: _, ...rest } = intent;
      const sig = signMessage(rest, buyerKeys.privateKey);

      const res = await request(app)
        .post('/bcp/intent')
        .send({ ...rest, signature: sig });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('BCP_002');
    });

    it('rejects messages with future timestamps beyond tolerance', async () => {
      const sm = new SessionManager();
      const app = createBCPServer(sm, {
        resolvePublicKey,
        maxAgeSec: 60,
        disableReplayProtection: true,
      });
      const futureTimestamp = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      const intent = makeSignedIntent({ timestamp: futureTimestamp });
      const { signature: _, ...rest } = intent;
      const sig = signMessage(rest, buyerKeys.privateKey);

      const res = await request(app)
        .post('/bcp/intent')
        .send({ ...rest, signature: sig });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('BCP_002');
    });

    it('accepts messages within the freshness window', async () => {
      const sm = new SessionManager();
      const app = createBCPServer(sm, {
        resolvePublicKey,
        maxAgeSec: 300,
        disableReplayProtection: true,
      });
      const intent = makeSignedIntent(); // uses current timestamp

      const res = await request(app)
        .post('/bcp/intent')
        .send(intent);

      expect(res.status).toBe(200);
    });
  });

  // ── 3. Replay protection ──────────────────────────────────────────
  describe('Replay protection', () => {
    it('rejects duplicate messages', async () => {
      const sm = new SessionManager();
      const app = createBCPServer(sm, {
        resolvePublicKey,
        disableTimestampCheck: true,
      });
      const intent = makeSignedIntent();

      // First send succeeds
      const res1 = await request(app)
        .post('/bcp/intent')
        .send(intent);
      expect(res1.status).toBe(200);

      // Second send (same message ID) is rejected
      const res2 = await request(app)
        .post('/bcp/intent')
        .send(intent);
      expect(res2.status).toBe(409);
      expect(res2.body.error.code).toBe('REPLAY_DETECTED');
    });

    it('allows different messages', async () => {
      const sm = new SessionManager();
      const app = createBCPServer(sm, {
        resolvePublicKey,
        disableTimestampCheck: true,
      });

      const intent1 = makeSignedIntent();
      const intent2 = makeSignedIntent(); // different intent_id

      const res1 = await request(app)
        .post('/bcp/intent')
        .send(intent1);
      expect(res1.status).toBe(200);

      const res2 = await request(app)
        .post('/bcp/intent')
        .send(intent2);
      expect(res2.status).toBe(200);
    });
  });

  // ── 4. Spending limit enforcement ─────────────────────────────────
  describe('Spending limit enforcement', () => {
    it('rejects COMMIT when escrow amount exceeds spending limit', async () => {
      const sm = new SessionManager();
      const app = createBCPServer(sm, {
        resolvePublicKey,
        disableTimestampCheck: true,
        disableReplayProtection: true,
      });

      // Post INTENT with spending_limit: 50000
      const intent = makeSignedIntent();
      const intentRes = await request(app).post('/bcp/intent').send(intent);
      expect(intentRes.status).toBe(200);

      // Post QUOTE
      const quote = makeSignedQuote(intent.intent_id as string);
      const quoteRes = await request(app).post('/bcp/quote').send(quote);
      expect(quoteRes.status).toBe(200);

      // Post COMMIT with amount EXCEEDING spending limit
      const commit = makeSignedCommit(quote.quote_id as string, 99999);
      const commitRes = await request(app).post('/bcp/commit').send(commit);
      expect(commitRes.status).toBe(400);
      expect(commitRes.body.error.code).toBe('BCP_004');
    });

    it('accepts COMMIT when escrow amount is within spending limit', async () => {
      const sm = new SessionManager();
      const app = createBCPServer(sm, {
        resolvePublicKey,
        disableTimestampCheck: true,
        disableReplayProtection: true,
      });

      const intent = makeSignedIntent();
      await request(app).post('/bcp/intent').send(intent);

      const quote = makeSignedQuote(intent.intent_id as string);
      await request(app).post('/bcp/quote').send(quote);

      const commit = makeSignedCommit(quote.quote_id as string, 5000); // within 50000 limit
      const commitRes = await request(app).post('/bcp/commit').send(commit);
      expect(commitRes.status).toBe(200);
    });
  });
});
