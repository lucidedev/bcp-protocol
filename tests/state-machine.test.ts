/**
 * Tests for BCP state machine transitions.
 */

import { v4 as uuidv4 } from 'uuid';
import { SessionManager, BCPError, BCPErrorCode } from '../src/state/session';
import { IntentMessage } from '../src/messages/intent';
import { QuoteMessage } from '../src/messages/quote';
import { CounterMessage } from '../src/messages/counter';
import { CommitMessage } from '../src/messages/commit';
import { FulfilMessage } from '../src/messages/fulfil';
import { DisputeMessage } from '../src/messages/dispute';

function makeIntent(): IntentMessage {
  return {
    bcp_version: '0.1',
    message_type: 'INTENT',
    intent_id: uuidv4(),
    timestamp: new Date().toISOString(),
    buyer: {
      org_id: 'buyer-org',
      agent_wallet_address: '0x' + 'a'.repeat(64),
      credential: '0x' + 'b'.repeat(64),
      spending_limit: 50000,
      currency: 'USDC',
    },
    requirements: {
      category: 'Test',
      quantity: 1,
      delivery_window: 'P7D',
      budget_max: 50000,
      payment_terms_acceptable: ['immediate', 'net30'],
    },
    ttl: 3600,
    signature: 'sig',
  };
}

function makeQuote(intentId: string): QuoteMessage {
  return {
    bcp_version: '0.1',
    message_type: 'QUOTE',
    quote_id: uuidv4(),
    intent_id: intentId,
    timestamp: new Date().toISOString(),
    seller: {
      org_id: 'seller-org',
      agent_wallet_address: '0x' + 'c'.repeat(64),
      credential: '0x' + 'd'.repeat(64),
    },
    offer: {
      price: 10000,
      currency: 'USDC',
      payment_terms: 'net30',
      delivery_date: new Date().toISOString(),
      validity_until: new Date(Date.now() + 7 * 86400_000).toISOString(),
      line_items: [{ description: 'Item', qty: 1, unit_price: 10000, unit: 'EA' }],
    },
    signature: 'sig',
  };
}

function makeCounter(refId: string): CounterMessage {
  return {
    bcp_version: '0.1',
    message_type: 'COUNTER',
    counter_id: uuidv4(),
    ref_id: refId,
    initiated_by: 'buyer',
    timestamp: new Date().toISOString(),
    proposed_changes: { price: 8000 },
    new_validity_until: new Date(Date.now() + 3600_000).toISOString(),
    signature: 'sig',
  };
}

function makeCommit(refId: string): CommitMessage {
  return {
    bcp_version: '0.1',
    message_type: 'COMMIT',
    commit_id: uuidv4(),
    accepted_ref_id: refId,
    timestamp: new Date().toISOString(),
    buyer_approval: {
      approved_by: '0x' + 'a'.repeat(64),
      approval_type: 'autonomous',
      threshold_exceeded: false,
    },
    escrow: {
      amount: 10000,
      currency: 'USDC',
      escrow_contract_address: '0x' + 'e'.repeat(40),
      release_condition: 'fulfil_confirmed',
      payment_schedule: { type: 'net30', due_date: new Date().toISOString() },
    },
    signature: 'sig',
  };
}

function makeFulfil(commitId: string): FulfilMessage {
  return {
    bcp_version: '0.1',
    message_type: 'FULFIL',
    fulfil_id: uuidv4(),
    commit_id: commitId,
    timestamp: new Date().toISOString(),
    delivery_proof: { type: 'service_confirmation', evidence: 'done' },
    invoice: {
      format: 'UBL2.1',
      invoice_id: 'INV-1',
      invoice_hash: 'a'.repeat(64),
      invoice_url: 'https://example.com/inv',
    },
    settlement_trigger: 'immediate',
    signature: 'sig',
  };
}

function makeDispute(commitId: string): DisputeMessage {
  return {
    bcp_version: '0.1',
    message_type: 'DISPUTE',
    dispute_id: uuidv4(),
    commit_id: commitId,
    timestamp: new Date().toISOString(),
    raised_by: 'buyer',
    reason: 'non_delivery',
    requested_resolution: 'full_refund',
    signature: 'sig',
  };
}

describe('SessionManager state machine', () => {
  let sm: SessionManager;

  beforeEach(() => {
    sm = new SessionManager();
  });

  test('INTENT creates session in INITIATED state', () => {
    const intent = makeIntent();
    const session = sm.processMessage(intent);
    expect(session.state).toBe('INITIATED');
    expect(session.intentId).toBe(intent.intent_id);
  });

  test('QUOTE transitions INITIATED → QUOTED', () => {
    const intent = makeIntent();
    sm.processMessage(intent);
    const quote = makeQuote(intent.intent_id);
    const session = sm.processMessage(quote);
    expect(session.state).toBe('QUOTED');
  });

  test('COUNTER transitions QUOTED → COUNTERED', () => {
    const intent = makeIntent();
    sm.processMessage(intent);
    const quote = makeQuote(intent.intent_id);
    sm.processMessage(quote);
    const counter = makeCounter(quote.quote_id);
    const session = sm.processMessage(counter);
    expect(session.state).toBe('COUNTERED');
  });

  test('COUNTER → COUNTER stays COUNTERED', () => {
    const intent = makeIntent();
    sm.processMessage(intent);
    const quote = makeQuote(intent.intent_id);
    sm.processMessage(quote);
    const counter1 = makeCounter(quote.quote_id);
    sm.processMessage(counter1);
    const counter2 = makeCounter(counter1.counter_id);
    const session = sm.processMessage(counter2);
    expect(session.state).toBe('COUNTERED');
  });

  test('COMMIT transitions QUOTED → COMMITTED', () => {
    const intent = makeIntent();
    sm.processMessage(intent);
    const quote = makeQuote(intent.intent_id);
    sm.processMessage(quote);
    const commit = makeCommit(quote.quote_id);
    const session = sm.processMessage(commit);
    expect(session.state).toBe('COMMITTED');
  });

  test('COMMIT transitions COUNTERED → COMMITTED', () => {
    const intent = makeIntent();
    sm.processMessage(intent);
    const quote = makeQuote(intent.intent_id);
    sm.processMessage(quote);
    const counter = makeCounter(quote.quote_id);
    sm.processMessage(counter);
    const commit = makeCommit(counter.counter_id);
    const session = sm.processMessage(commit);
    expect(session.state).toBe('COMMITTED');
  });

  test('FULFIL transitions COMMITTED → FULFILLED', () => {
    const intent = makeIntent();
    sm.processMessage(intent);
    const quote = makeQuote(intent.intent_id);
    sm.processMessage(quote);
    const commit = makeCommit(quote.quote_id);
    sm.processMessage(commit);
    const fulfil = makeFulfil(commit.commit_id);
    const session = sm.processMessage(fulfil);
    expect(session.state).toBe('FULFILLED');
  });

  test('DISPUTE transitions COMMITTED → DISPUTED', () => {
    const intent = makeIntent();
    sm.processMessage(intent);
    const quote = makeQuote(intent.intent_id);
    sm.processMessage(quote);
    const commit = makeCommit(quote.quote_id);
    sm.processMessage(commit);
    const dispute = makeDispute(commit.commit_id);
    const session = sm.processMessage(dispute);
    expect(session.state).toBe('DISPUTED');
  });

  test('markUnfrozen transitions DISPUTED → COMMITTED', () => {
    const intent = makeIntent();
    sm.processMessage(intent);
    const quote = makeQuote(intent.intent_id);
    sm.processMessage(quote);
    const commit = makeCommit(quote.quote_id);
    sm.processMessage(commit);
    const dispute = makeDispute(commit.commit_id);
    sm.processMessage(dispute);
    const session = sm.markUnfrozen(commit.commit_id);
    expect(session.state).toBe('COMMITTED');
  });

  test('markUnfrozen rejects if not DISPUTED', () => {
    const intent = makeIntent();
    sm.processMessage(intent);
    const quote = makeQuote(intent.intent_id);
    sm.processMessage(quote);
    const commit = makeCommit(quote.quote_id);
    sm.processMessage(commit);
    // Session is COMMITTED, not DISPUTED
    expect(() => sm.markUnfrozen(commit.commit_id)).toThrow(BCPError);
  });

  test('FULFIL works after DISPUTED → COMMITTED (unfreeze)', () => {
    const intent = makeIntent();
    sm.processMessage(intent);
    const quote = makeQuote(intent.intent_id);
    sm.processMessage(quote);
    const commit = makeCommit(quote.quote_id);
    sm.processMessage(commit);
    const dispute = makeDispute(commit.commit_id);
    sm.processMessage(dispute);
    sm.markUnfrozen(commit.commit_id);
    const fulfil = makeFulfil(commit.commit_id);
    const session = sm.processMessage(fulfil);
    expect(session.state).toBe('FULFILLED');
  });

  test('rejects COMMIT directly after INTENT (invalid transition)', () => {
    const intent = makeIntent();
    sm.processMessage(intent);
    // Need to provide a valid ref — but since there's no quote, the ref won't resolve
    // to a session, so we expect UNKNOWN_REF_ID
    const commit = makeCommit(uuidv4());
    expect(() => sm.processMessage(commit)).toThrow(BCPError);
  });

  test('rejects FULFIL in QUOTED state', () => {
    const intent = makeIntent();
    sm.processMessage(intent);
    const quote = makeQuote(intent.intent_id);
    sm.processMessage(quote);
    // Fulfil needs a commit_id, but no commit exists — triggers UNKNOWN_REF_ID
    const fulfil = makeFulfil(uuidv4());
    expect(() => sm.processMessage(fulfil)).toThrow(BCPError);
  });

  test('rejects QUOTE for unknown intent_id', () => {
    const quote = makeQuote(uuidv4());
    expect(() => sm.processMessage(quote)).toThrow(BCPError);
  });

  test('tracks messages in session', () => {
    const intent = makeIntent();
    sm.processMessage(intent);
    const quote = makeQuote(intent.intent_id);
    sm.processMessage(quote);
    const session = sm.getSession(intent.intent_id)!;
    expect(session.messages).toHaveLength(2);
    expect(session.messages[0].message_type).toBe('INTENT');
    expect(session.messages[1].message_type).toBe('QUOTE');
  });

  test('getAllSessions returns all sessions', () => {
    const intent1 = makeIntent();
    const intent2 = makeIntent();
    sm.processMessage(intent1);
    sm.processMessage(intent2);
    expect(sm.getAllSessions()).toHaveLength(2);
  });

  test('rejects COMMIT against expired quote', () => {
    const intent = makeIntent();
    sm.processMessage(intent);
    // Create a quote that already expired
    const quote = makeQuote(intent.intent_id);
    quote.offer.validity_until = new Date(Date.now() - 1000).toISOString();
    sm.processMessage(quote);
    const commit = makeCommit(quote.quote_id);
    expect(() => sm.processMessage(commit)).toThrow(BCPError);
    try {
      sm.processMessage(makeCommit(quote.quote_id));
    } catch (e) {
      expect((e as BCPError).code).toBe(BCPErrorCode.EXPIRED_MESSAGE);
    }
  });

  test('rejects COMMIT against expired counter', () => {
    const intent = makeIntent();
    sm.processMessage(intent);
    const quote = makeQuote(intent.intent_id);
    sm.processMessage(quote);
    const counter = makeCounter(quote.quote_id);
    counter.new_validity_until = new Date(Date.now() - 1000).toISOString();
    sm.processMessage(counter);
    const commit = makeCommit(counter.counter_id);
    expect(() => sm.processMessage(commit)).toThrow(BCPError);
  });
});
