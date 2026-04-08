/**
 * Tests for BCP v0.2 message validation.
 */

import { validateMessageV2, ValidationResult } from '../src/validation/validator-v2';
import type {
  IntentMessageV2,
  QuoteMessageV2,
  CounterMessageV2,
  CommitMessageV2,
  FulfilMessageV2,
  DisputeMessageV2,
} from '../src/messages/v2';

function makeIntent(overrides: Partial<IntentMessageV2> = {}): IntentMessageV2 {
  return {
    bcp_version: '0.2',
    type: 'intent',
    sessionId: 'bcp_test123',
    timestamp: new Date().toISOString(),
    service: 'Logo design for a fintech startup',
    ...overrides,
  };
}

function makeQuote(overrides: Partial<QuoteMessageV2> = {}): QuoteMessageV2 {
  return {
    bcp_version: '0.2',
    type: 'quote',
    sessionId: 'bcp_test123',
    timestamp: new Date().toISOString(),
    price: 500,
    currency: 'USD',
    ...overrides,
  };
}

function makeCounter(overrides: Partial<CounterMessageV2> = {}): CounterMessageV2 {
  return {
    bcp_version: '0.2',
    type: 'counter',
    sessionId: 'bcp_test123',
    timestamp: new Date().toISOString(),
    counterPrice: 350,
    ...overrides,
  };
}

function makeCommit(overrides: Partial<CommitMessageV2> = {}): CommitMessageV2 {
  return {
    bcp_version: '0.2',
    type: 'commit',
    sessionId: 'bcp_test123',
    timestamp: new Date().toISOString(),
    agreedPrice: 400,
    currency: 'USD',
    ...overrides,
  };
}

function makeFulfil(overrides: Partial<FulfilMessageV2> = {}): FulfilMessageV2 {
  return {
    bcp_version: '0.2',
    type: 'fulfil',
    sessionId: 'bcp_test123',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function makeDispute(overrides: Partial<DisputeMessageV2> = {}): DisputeMessageV2 {
  return {
    bcp_version: '0.2',
    type: 'dispute',
    sessionId: 'bcp_test123',
    timestamp: new Date().toISOString(),
    reason: 'Logos use heavy gradients, not minimalist as requested',
    ...overrides,
  };
}

// ── INTENT ───────────────────────────────────────────────────────

describe('v0.2 INTENT validation', () => {
  test('minimal intent passes', () => {
    const result = validateMessageV2(makeIntent() as unknown as Record<string, unknown>);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('intent with all optional fields passes', () => {
    const result = validateMessageV2(
      makeIntent({
        budget: 1000,
        currency: 'USD',
        auth: 'ed25519',
        rfqId: 'rfq_abc',
        callbackUrl: 'https://buyer.example.com/bcp',
        signature: 'a'.repeat(128),
      }) as unknown as Record<string, unknown>,
    );
    expect(result.valid).toBe(true);
  });

  test('missing service fails', () => {
    const msg = makeIntent();
    delete (msg as any).service;
    const result = validateMessageV2(msg as unknown as Record<string, unknown>);
    expect(result.valid).toBe(false);
  });

  test('missing sessionId fails', () => {
    const msg = makeIntent();
    delete (msg as any).sessionId;
    const result = validateMessageV2(msg as unknown as Record<string, unknown>);
    expect(result.valid).toBe(false);
  });

  test('wrong bcp_version fails', () => {
    const result = validateMessageV2(
      makeIntent({ bcp_version: '0.1' as any }) as unknown as Record<string, unknown>,
    );
    expect(result.valid).toBe(false);
  });

  test('invalid auth mode fails', () => {
    const result = validateMessageV2(
      makeIntent({ auth: 'oauth' as any }) as unknown as Record<string, unknown>,
    );
    expect(result.valid).toBe(false);
  });
});

// ── QUOTE ────────────────────────────────────────────────────────

describe('v0.2 QUOTE validation', () => {
  test('minimal quote passes', () => {
    const result = validateMessageV2(makeQuote() as unknown as Record<string, unknown>);
    expect(result.valid).toBe(true);
  });

  test('quote with deliverables and settlement passes', () => {
    const result = validateMessageV2(
      makeQuote({
        deliverables: ['logo.svg', 'guide.pdf'],
        estimatedDays: 5,
        settlement: 'invoice',
      }) as unknown as Record<string, unknown>,
    );
    expect(result.valid).toBe(true);
  });

  test('missing price fails', () => {
    const msg = makeQuote();
    delete (msg as any).price;
    const result = validateMessageV2(msg as unknown as Record<string, unknown>);
    expect(result.valid).toBe(false);
  });

  test('invalid settlement fails', () => {
    const result = validateMessageV2(
      makeQuote({ settlement: 'bitcoin' as any }) as unknown as Record<string, unknown>,
    );
    expect(result.valid).toBe(false);
  });
});

// ── COUNTER ──────────────────────────────────────────────────────

describe('v0.2 COUNTER validation', () => {
  test('minimal counter passes', () => {
    const result = validateMessageV2(makeCounter() as unknown as Record<string, unknown>);
    expect(result.valid).toBe(true);
  });

  test('counter with reason passes', () => {
    const result = validateMessageV2(
      makeCounter({ reason: 'Budget is tight' }) as unknown as Record<string, unknown>,
    );
    expect(result.valid).toBe(true);
  });

  test('missing counterPrice fails', () => {
    const msg = makeCounter();
    delete (msg as any).counterPrice;
    const result = validateMessageV2(msg as unknown as Record<string, unknown>);
    expect(result.valid).toBe(false);
  });
});

// ── COMMIT ───────────────────────────────────────────────────────

describe('v0.2 COMMIT validation', () => {
  test('minimal commit passes', () => {
    const result = validateMessageV2(makeCommit() as unknown as Record<string, unknown>);
    expect(result.valid).toBe(true);
  });

  test('commit with escrow passes', () => {
    const result = validateMessageV2(
      makeCommit({
        settlement: 'escrow',
        escrow: { contractAddress: '0x' + 'a'.repeat(40), txHash: '0x' + 'b'.repeat(64) },
      }) as unknown as Record<string, unknown>,
    );
    expect(result.valid).toBe(true);
  });

  test('missing agreedPrice fails', () => {
    const msg = makeCommit();
    delete (msg as any).agreedPrice;
    const result = validateMessageV2(msg as unknown as Record<string, unknown>);
    expect(result.valid).toBe(false);
  });
});

// ── FULFIL ───────────────────────────────────────────────────────

describe('v0.2 FULFIL validation', () => {
  test('minimal fulfil passes (just envelope)', () => {
    const result = validateMessageV2(makeFulfil() as unknown as Record<string, unknown>);
    expect(result.valid).toBe(true);
  });

  test('fulfil with all fields passes', () => {
    const result = validateMessageV2(
      makeFulfil({
        deliverables: ['logo.svg'],
        summary: 'Delivered 3 concepts',
        proofHash: 'a'.repeat(64),
        invoiceUrl: 'https://seller.example.com/inv/123',
      }) as unknown as Record<string, unknown>,
    );
    expect(result.valid).toBe(true);
  });

  test('invalid proofHash fails', () => {
    const result = validateMessageV2(
      makeFulfil({ proofHash: 'not-a-hash' }) as unknown as Record<string, unknown>,
    );
    expect(result.valid).toBe(false);
  });
});

// ── DISPUTE ──────────────────────────────────────────────────────

describe('v0.2 DISPUTE validation', () => {
  test('minimal dispute passes', () => {
    const result = validateMessageV2(makeDispute() as unknown as Record<string, unknown>);
    expect(result.valid).toBe(true);
  });

  test('dispute with resolution passes', () => {
    const result = validateMessageV2(
      makeDispute({ resolution: 'redeliver' }) as unknown as Record<string, unknown>,
    );
    expect(result.valid).toBe(true);
  });

  test('missing reason fails', () => {
    const msg = makeDispute();
    delete (msg as any).reason;
    const result = validateMessageV2(msg as unknown as Record<string, unknown>);
    expect(result.valid).toBe(false);
  });

  test('invalid resolution fails', () => {
    const result = validateMessageV2(
      makeDispute({ resolution: 'destroy' as any }) as unknown as Record<string, unknown>,
    );
    expect(result.valid).toBe(false);
  });
});

// ── Unknown type ─────────────────────────────────────────────────

describe('v0.2 unknown type', () => {
  test('unknown type returns error', () => {
    const result = validateMessageV2({ bcp_version: '0.2', type: 'cancel', sessionId: 'x', timestamp: new Date().toISOString() });
    expect(result.valid).toBe(false);
    expect(result.errors[0].path).toBe('/type');
  });

  test('missing type returns error', () => {
    const result = validateMessageV2({ bcp_version: '0.2', sessionId: 'x' });
    expect(result.valid).toBe(false);
  });
});
