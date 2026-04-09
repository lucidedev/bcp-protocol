/**
 * BCP state machine tests — session lifecycle with v0.3 message types.
 */

import { SessionManager, BCPError, BCPErrorCode } from '../src/state/session';
import type { BCPMessage, IntentMessage, QuoteMessage, CounterMessage, CommitMessage, FulfilMessage, AcceptMessage, DisputeMessage } from '../src/messages/types';

const ts = () => new Date().toISOString();

function makeIntent(sessionId: string = 'sess-1'): IntentMessage {
  return { bcp_version: '0.3', type: 'intent', sessionId, timestamp: ts(), service: 'Logo design', budget: 500, currency: 'USDC' };
}

function makeQuote(sessionId: string = 'sess-1'): QuoteMessage {
  return { bcp_version: '0.3', type: 'quote', sessionId, timestamp: ts(), price: 250, currency: 'USDC', deliverables: ['Logo'] };
}

function makeCounter(sessionId: string = 'sess-1'): CounterMessage {
  return { bcp_version: '0.3', type: 'counter', sessionId, timestamp: ts(), counterPrice: 200 };
}

function makeCommit(sessionId: string = 'sess-1'): CommitMessage {
  return { bcp_version: '0.3', type: 'commit', sessionId, timestamp: ts(), agreedPrice: 200, currency: 'USDC' };
}

function makeFulfil(sessionId: string = 'sess-1'): FulfilMessage {
  return { bcp_version: '0.3', type: 'fulfil', sessionId, timestamp: ts(), summary: 'Done' };
}

function makeAccept(sessionId: string = 'sess-1'): AcceptMessage {
  return { bcp_version: '0.3', type: 'accept', sessionId, timestamp: ts(), rating: 5 };
}

function makeDispute(sessionId: string = 'sess-1'): DisputeMessage {
  return { bcp_version: '0.3', type: 'dispute', sessionId, timestamp: ts(), reason: 'Non-delivery' };
}

describe('SessionManager', () => {
  let sm: SessionManager;

  beforeEach(() => {
    sm = new SessionManager();
  });

  test('INTENT creates a new session in initiated state', () => {
    const session = sm.processMessage(makeIntent());
    expect(session.state).toBe('initiated');
    expect(session.sessionId).toBe('sess-1');
    expect(session.messages).toHaveLength(1);
  });

  test('full happy path: intent → quote → commit → fulfil → accept', () => {
    sm.processMessage(makeIntent());
    const s2 = sm.processMessage(makeQuote());
    expect(s2.state).toBe('quoted');

    const s3 = sm.processMessage(makeCommit());
    expect(s3.state).toBe('committed');

    const s4 = sm.processMessage(makeFulfil());
    expect(s4.state).toBe('fulfilled');

    const s5 = sm.processMessage(makeAccept());
    expect(s5.state).toBe('accepted');

    expect(s5.messages).toHaveLength(5);
  });

  test('negotiation path: intent → quote → counter → quote → commit', () => {
    sm.processMessage(makeIntent());
    sm.processMessage(makeQuote());
    const s3 = sm.processMessage(makeCounter());
    expect(s3.state).toBe('countered');

    // Revised quote
    const s4 = sm.processMessage(makeQuote());
    expect(s4.state).toBe('quoted');

    const s5 = sm.processMessage(makeCommit());
    expect(s5.state).toBe('committed');
  });

  test('dispute from committed state', () => {
    sm.processMessage(makeIntent());
    sm.processMessage(makeQuote());
    sm.processMessage(makeCommit());
    const s4 = sm.processMessage(makeDispute());
    expect(s4.state).toBe('disputed');
  });

  test('dispute from fulfilled state', () => {
    sm.processMessage(makeIntent());
    sm.processMessage(makeQuote());
    sm.processMessage(makeCommit());
    sm.processMessage(makeFulfil());
    const s5 = sm.processMessage(makeDispute());
    expect(s5.state).toBe('disputed');
  });

  test('rejects invalid transition: commit before quote', () => {
    sm.processMessage(makeIntent());
    expect(() => sm.processMessage(makeCommit())).toThrow(BCPError);
  });

  test('rejects invalid transition: fulfil before commit', () => {
    sm.processMessage(makeIntent());
    sm.processMessage(makeQuote());
    expect(() => sm.processMessage(makeFulfil())).toThrow(BCPError);
  });

  test('rejects message for unknown session', () => {
    expect(() => sm.processMessage(makeQuote('nonexistent'))).toThrow(BCPError);
  });

  test('rejects accept before fulfil', () => {
    sm.processMessage(makeIntent());
    sm.processMessage(makeQuote());
    sm.processMessage(makeCommit());
    expect(() => sm.processMessage(makeAccept())).toThrow(BCPError);
  });

  test('tracks buyer DID from intent', () => {
    const intent = makeIntent();
    intent.did = 'did:key:z6Mk_buyer';
    const session = sm.processMessage(intent);
    expect(session.buyerDid).toBe('did:key:z6Mk_buyer');
  });

  test('tracks seller DID from quote', () => {
    sm.processMessage(makeIntent());
    const quote = makeQuote();
    quote.did = 'did:key:z6Mk_seller';
    const session = sm.processMessage(quote);
    expect(session.sellerDid).toBe('did:key:z6Mk_seller');
  });

  test('tracks callbackUrl from intent', () => {
    const intent = makeIntent();
    intent.callbackUrl = 'https://buyer.example.com/callback';
    const session = sm.processMessage(intent);
    expect(session.callbackUrl).toBe('https://buyer.example.com/callback');
  });

  test('multiple counter offers', () => {
    sm.processMessage(makeIntent());
    sm.processMessage(makeQuote());
    sm.processMessage(makeCounter());
    sm.processMessage(makeCounter());
    const s = sm.processMessage(makeCounter());
    expect(s.state).toBe('countered');
    expect(s.messages).toHaveLength(5);
  });

  test('getSession returns session by ID', () => {
    sm.processMessage(makeIntent());
    const session = sm.getSession('sess-1');
    expect(session).toBeDefined();
    expect(session!.sessionId).toBe('sess-1');
  });

  test('getSession returns undefined for unknown ID', () => {
    expect(sm.getSession('nope')).toBeUndefined();
  });

  test('getAllSessions returns all sessions', () => {
    sm.processMessage(makeIntent('s1'));
    sm.processMessage(makeIntent('s2'));
    expect(sm.getAllSessions()).toHaveLength(2);
  });
});
