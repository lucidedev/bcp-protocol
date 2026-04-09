/**
 * BCP message validation tests — lean v0.3 message types.
 */

import { validateMessage, validateMessageType } from '../src/validation/validator';

describe('v0.3 message validation', () => {
  test('valid INTENT message', () => {
    const result = validateMessage({
      bcp_version: '0.3',
      type: 'intent',
      sessionId: 'sess-1',
      timestamp: new Date().toISOString(),
      service: 'Logo design',
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('valid INTENT with all optional fields', () => {
    const result = validateMessage({
      bcp_version: '0.3',
      type: 'intent',
      sessionId: 'sess-1',
      timestamp: new Date().toISOString(),
      service: 'Logo design',
      budget: 500,
      currency: 'USDC',
      auth: 'ed25519',
      rfqId: 'rfq-1',
      did: 'did:key:z6Mk...',
    });
    expect(result.valid).toBe(true);
  });

  test('rejects INTENT with missing service', () => {
    const result = validateMessage({
      bcp_version: '0.3',
      type: 'intent',
      sessionId: 'sess-1',
      timestamp: new Date().toISOString(),
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('service'))).toBe(true);
  });

  test('rejects unknown message type', () => {
    const result = validateMessage({
      bcp_version: '0.3',
      type: 'UNKNOWN',
      sessionId: 'sess-1',
      timestamp: new Date().toISOString(),
    });
    expect(result.valid).toBe(false);
  });

  test('valid QUOTE message', () => {
    const result = validateMessage({
      bcp_version: '0.3',
      type: 'quote',
      sessionId: 'sess-1',
      timestamp: new Date().toISOString(),
      price: 250,
      currency: 'USDC',
    });
    expect(result.valid).toBe(true);
  });

  test('valid QUOTE with deliverables', () => {
    const result = validateMessage({
      bcp_version: '0.3',
      type: 'quote',
      sessionId: 'sess-1',
      timestamp: new Date().toISOString(),
      price: 250,
      currency: 'USDC',
      deliverables: ['Logo file', 'Brand guidelines'],
      estimatedDays: 7,
      settlement: 'escrow',
    });
    expect(result.valid).toBe(true);
  });

  test('rejects QUOTE with missing price', () => {
    const result = validateMessage({
      bcp_version: '0.3',
      type: 'quote',
      sessionId: 'sess-1',
      timestamp: new Date().toISOString(),
      currency: 'USDC',
    });
    expect(result.valid).toBe(false);
  });

  test('valid COUNTER message', () => {
    const result = validateMessage({
      bcp_version: '0.3',
      type: 'counter',
      sessionId: 'sess-1',
      timestamp: new Date().toISOString(),
      counterPrice: 200,
    });
    expect(result.valid).toBe(true);
  });

  test('valid COMMIT message', () => {
    const result = validateMessage({
      bcp_version: '0.3',
      type: 'commit',
      sessionId: 'sess-1',
      timestamp: new Date().toISOString(),
      agreedPrice: 200,
      currency: 'USDC',
    });
    expect(result.valid).toBe(true);
  });

  test('valid COMMIT with escrow', () => {
    const result = validateMessage({
      bcp_version: '0.3',
      type: 'commit',
      sessionId: 'sess-1',
      timestamp: new Date().toISOString(),
      agreedPrice: 200,
      currency: 'USDC',
      settlement: 'escrow',
      escrow: { contractAddress: '0x1234' },
    });
    expect(result.valid).toBe(true);
  });

  test('valid FULFIL message', () => {
    const result = validateMessage({
      bcp_version: '0.3',
      type: 'fulfil',
      sessionId: 'sess-1',
      timestamp: new Date().toISOString(),
      summary: 'Done',
    });
    expect(result.valid).toBe(true);
  });

  test('valid ACCEPT message', () => {
    const result = validateMessage({
      bcp_version: '0.3',
      type: 'accept',
      sessionId: 'sess-1',
      timestamp: new Date().toISOString(),
      rating: 5,
      feedback: 'Great work!',
    });
    expect(result.valid).toBe(true);
  });

  test('rejects ACCEPT with invalid rating', () => {
    const result = validateMessage({
      bcp_version: '0.3',
      type: 'accept',
      sessionId: 'sess-1',
      timestamp: new Date().toISOString(),
      rating: 10,
    });
    expect(result.valid).toBe(false);
  });

  test('valid DISPUTE message', () => {
    const result = validateMessage({
      bcp_version: '0.3',
      type: 'dispute',
      sessionId: 'sess-1',
      timestamp: new Date().toISOString(),
      reason: 'Work was not delivered',
      resolution: 'refund',
    });
    expect(result.valid).toBe(true);
  });

  test('rejects DISPUTE with missing reason', () => {
    const result = validateMessage({
      bcp_version: '0.3',
      type: 'dispute',
      sessionId: 'sess-1',
      timestamp: new Date().toISOString(),
    });
    expect(result.valid).toBe(false);
  });

  test('validateMessageType validates known type', () => {
    const result = validateMessageType('intent', {
      bcp_version: '0.3',
      type: 'intent',
      sessionId: 'sess-1',
      timestamp: new Date().toISOString(),
      service: 'Logo design',
    });
    expect(result.valid).toBe(true);
  });

  test('all 7 message types validate', () => {
    const messages = [
      { bcp_version: '0.3', type: 'intent', sessionId: 's', timestamp: new Date().toISOString(), service: 'x' },
      { bcp_version: '0.3', type: 'quote', sessionId: 's', timestamp: new Date().toISOString(), price: 1, currency: 'USD' },
      { bcp_version: '0.3', type: 'counter', sessionId: 's', timestamp: new Date().toISOString(), counterPrice: 1 },
      { bcp_version: '0.3', type: 'commit', sessionId: 's', timestamp: new Date().toISOString(), agreedPrice: 1, currency: 'USD' },
      { bcp_version: '0.3', type: 'fulfil', sessionId: 's', timestamp: new Date().toISOString() },
      { bcp_version: '0.3', type: 'accept', sessionId: 's', timestamp: new Date().toISOString() },
      { bcp_version: '0.3', type: 'dispute', sessionId: 's', timestamp: new Date().toISOString(), reason: 'r' },
    ];
    for (const msg of messages) {
      const result = validateMessage(msg);
      expect(result.valid).toBe(true);
    }
  });
});
