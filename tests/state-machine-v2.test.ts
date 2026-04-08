/**
 * Tests for BCP v0.2 session state machine.
 */

import {
  SessionManagerV2,
  BCPErrorV2,
  BCPErrorCodeV2,
} from '../src/state/session-v2';
import type {
  IntentMessageV2,
  QuoteMessageV2,
  CounterMessageV2,
  CommitMessageV2,
  FulfilMessageV2,
  DisputeMessageV2,
} from '../src/messages/v2';

const sid = 'bcp_test_session';
const ts = () => new Date().toISOString();

function intent(overrides: Partial<IntentMessageV2> = {}): IntentMessageV2 {
  return {
    bcp_version: '0.2', type: 'intent', sessionId: sid, timestamp: ts(),
    service: 'Logo design', ...overrides,
  };
}

function quote(overrides: Partial<QuoteMessageV2> = {}): QuoteMessageV2 {
  return {
    bcp_version: '0.2', type: 'quote', sessionId: sid, timestamp: ts(),
    price: 500, currency: 'USD', ...overrides,
  };
}

function counter(overrides: Partial<CounterMessageV2> = {}): CounterMessageV2 {
  return {
    bcp_version: '0.2', type: 'counter', sessionId: sid, timestamp: ts(),
    counterPrice: 350, ...overrides,
  };
}

function commit(overrides: Partial<CommitMessageV2> = {}): CommitMessageV2 {
  return {
    bcp_version: '0.2', type: 'commit', sessionId: sid, timestamp: ts(),
    agreedPrice: 400, currency: 'USD', ...overrides,
  };
}

function fulfil(overrides: Partial<FulfilMessageV2> = {}): FulfilMessageV2 {
  return {
    bcp_version: '0.2', type: 'fulfil', sessionId: sid, timestamp: ts(),
    ...overrides,
  };
}

function dispute(overrides: Partial<DisputeMessageV2> = {}): DisputeMessageV2 {
  return {
    bcp_version: '0.2', type: 'dispute', sessionId: sid, timestamp: ts(),
    reason: 'Wrong deliverables', ...overrides,
  };
}

describe('v0.2 State Machine', () => {
  let sm: SessionManagerV2;

  beforeEach(() => {
    sm = new SessionManagerV2();
  });

  // ── Happy path ───────────────────────────────────────────────

  test('full flow: intent → quote → commit → fulfil', () => {
    sm.processMessage(intent());
    expect(sm.getSession(sid)!.state).toBe('initiated');

    sm.processMessage(quote());
    expect(sm.getSession(sid)!.state).toBe('quoted');

    sm.processMessage(commit());
    expect(sm.getSession(sid)!.state).toBe('committed');

    sm.processMessage(fulfil());
    expect(sm.getSession(sid)!.state).toBe('fulfilled');
  });

  test('negotiation: intent → quote → counter → quote → commit', () => {
    sm.processMessage(intent());
    sm.processMessage(quote());
    sm.processMessage(counter());
    expect(sm.getSession(sid)!.state).toBe('countered');

    // Seller sends revised quote
    sm.processMessage(quote({ price: 400 }));
    expect(sm.getSession(sid)!.state).toBe('quoted');

    sm.processMessage(commit());
    expect(sm.getSession(sid)!.state).toBe('committed');
  });

  test('counter chains: counter → counter → commit', () => {
    sm.processMessage(intent());
    sm.processMessage(quote());
    sm.processMessage(counter({ counterPrice: 400 }));
    sm.processMessage(counter({ counterPrice: 420 }));
    sm.processMessage(counter({ counterPrice: 430 }));
    expect(sm.getSession(sid)!.state).toBe('countered');

    sm.processMessage(commit());
    expect(sm.getSession(sid)!.state).toBe('committed');
  });

  test('dispute from committed', () => {
    sm.processMessage(intent());
    sm.processMessage(quote());
    sm.processMessage(commit());
    sm.processMessage(dispute());
    expect(sm.getSession(sid)!.state).toBe('disputed');
  });

  // ── Price tracking ───────────────────────────────────────────

  test('lastPrice tracks through negotiation', () => {
    sm.processMessage(intent());
    sm.processMessage(quote({ price: 500 }));
    expect(sm.getSession(sid)!.lastPrice).toBe(500);

    sm.processMessage(counter({ counterPrice: 300 }));
    expect(sm.getSession(sid)!.lastPrice).toBe(300);

    sm.processMessage(quote({ price: 400 }));
    expect(sm.getSession(sid)!.lastPrice).toBe(400);
  });

  // ── Settlement tracking ──────────────────────────────────────

  test('settlement set by quote and preserved', () => {
    sm.processMessage(intent());
    sm.processMessage(quote({ settlement: 'invoice' }));
    expect(sm.getSession(sid)!.settlement).toBe('invoice');

    sm.processMessage(commit({ settlement: 'invoice' }));
    expect(sm.getSession(sid)!.settlement).toBe('invoice');
  });

  test('no settlement defaults to null', () => {
    sm.processMessage(intent());
    expect(sm.getSession(sid)!.settlement).toBeNull();
  });

  // ── Auth mode ────────────────────────────────────────────────

  test('auth mode captured from intent', () => {
    sm.processMessage(intent({ auth: 'ed25519' }));
    expect(sm.getSession(sid)!.auth).toBe('ed25519');
  });

  test('auth defaults to none', () => {
    sm.processMessage(intent());
    expect(sm.getSession(sid)!.auth).toBe('none');
  });

  // ── Message history ──────────────────────────────────────────

  test('messages array tracks all messages', () => {
    sm.processMessage(intent());
    sm.processMessage(quote());
    sm.processMessage(commit());
    sm.processMessage(fulfil());
    expect(sm.getSession(sid)!.messages).toHaveLength(4);
  });

  // ── Invalid transitions ──────────────────────────────────────

  test('rejects commit on initiated state', () => {
    sm.processMessage(intent());
    expect(() => sm.processMessage(commit())).toThrow(BCPErrorV2);
    try {
      sm.processMessage(commit());
    } catch (e) {
      expect((e as BCPErrorV2).code).toBe(BCPErrorCodeV2.INVALID_STATE);
    }
  });

  test('rejects fulfil on quoted state', () => {
    sm.processMessage(intent());
    sm.processMessage(quote());
    expect(() => sm.processMessage(fulfil())).toThrow(BCPErrorV2);
  });

  test('rejects quote after fulfilled', () => {
    sm.processMessage(intent());
    sm.processMessage(quote());
    sm.processMessage(commit());
    sm.processMessage(fulfil());
    expect(() => sm.processMessage(quote())).toThrow(BCPErrorV2);
  });

  // ── Unknown session ──────────────────────────────────────────

  test('rejects message for unknown session', () => {
    expect(() => sm.processMessage(quote({ sessionId: 'unknown' }))).toThrow(BCPErrorV2);
    try {
      sm.processMessage(quote({ sessionId: 'nope' }));
    } catch (e) {
      expect((e as BCPErrorV2).code).toBe(BCPErrorCodeV2.UNKNOWN_SESSION);
    }
  });

  // ── Quote expiry ─────────────────────────────────────────────

  test('rejects commit on expired quote', () => {
    sm.processMessage(intent());
    sm.processMessage(quote({ validUntil: new Date(Date.now() - 60_000).toISOString() }));
    expect(() => sm.processMessage(commit())).toThrow(BCPErrorV2);
    try {
      sm.processMessage(commit());
    } catch (e) {
      expect((e as BCPErrorV2).code).toBe(BCPErrorCodeV2.EXPIRED);
    }
  });

  // ── getAllSessions ───────────────────────────────────────────

  test('getAllSessions returns all sessions', () => {
    sm.processMessage(intent({ sessionId: 'a' }));
    sm.processMessage(intent({ sessionId: 'b' }));
    expect(sm.getAllSessions()).toHaveLength(2);
  });
});
