/**
 * Tests for Ed25519 signature signing and verification.
 */

import {
  signMessage,
  verifyMessage,
  generateKeypair,
  getPublicKey,
  getSigningPayload,
  deepCanonicalJson,
} from '../src/validation/signature';

describe('Ed25519 signature', () => {
  const keys = generateKeypair();

  test('generateKeypair returns hex strings', () => {
    expect(keys.privateKey).toMatch(/^[0-9a-f]+$/);
    expect(keys.publicKey).toMatch(/^[0-9a-f]+$/);
    expect(keys.privateKey.length).toBe(64); // 32 bytes hex
    expect(keys.publicKey.length).toBe(64);  // 32 bytes hex
  });

  test('getPublicKey derives correct public key', () => {
    const derived = getPublicKey(keys.privateKey);
    expect(derived).toBe(keys.publicKey);
  });

  test('signMessage produces a hex signature', () => {
    const message = {
      bcp_version: '0.1',
      message_type: 'INTENT',
      intent_id: 'test-id',
      timestamp: '2026-01-01T00:00:00Z',
    };
    const sig = signMessage(message, keys.privateKey);
    expect(sig).toMatch(/^[0-9a-f]+$/);
    expect(sig.length).toBe(128); // 64 bytes hex
  });

  test('verifyMessage confirms valid signature', () => {
    const message: Record<string, unknown> = {
      bcp_version: '0.1',
      message_type: 'INTENT',
      intent_id: 'test-id',
      timestamp: '2026-01-01T00:00:00Z',
    };
    const sig = signMessage(message, keys.privateKey);
    message.signature = sig;
    expect(verifyMessage(message, keys.publicKey)).toBe(true);
  });

  test('verifyMessage rejects tampered message', () => {
    const message: Record<string, unknown> = {
      bcp_version: '0.1',
      message_type: 'INTENT',
      intent_id: 'test-id',
      timestamp: '2026-01-01T00:00:00Z',
    };
    const sig = signMessage(message, keys.privateKey);
    message.signature = sig;
    message.intent_id = 'tampered-id'; // Tamper!
    expect(verifyMessage(message, keys.publicKey)).toBe(false);
  });

  test('verifyMessage rejects wrong public key', () => {
    const otherKeys = generateKeypair();
    const message: Record<string, unknown> = {
      bcp_version: '0.1',
      message_type: 'INTENT',
      intent_id: 'test-id',
      timestamp: '2026-01-01T00:00:00Z',
    };
    const sig = signMessage(message, keys.privateKey);
    message.signature = sig;
    expect(verifyMessage(message, otherKeys.publicKey)).toBe(false);
  });

  test('verifyMessage rejects missing signature', () => {
    const message: Record<string, unknown> = {
      bcp_version: '0.1',
      message_type: 'INTENT',
    };
    expect(verifyMessage(message, keys.publicKey)).toBe(false);
  });

  test('signature is over canonical JSON (key order independent)', () => {
    const msg1: Record<string, unknown> = { b: 2, a: 1 };
    const msg2: Record<string, unknown> = { a: 1, b: 2 };
    const payload1 = getSigningPayload(msg1);
    const payload2 = getSigningPayload(msg2);
    expect(payload1).toBe(payload2);
  });

  test('deepCanonicalJson sorts nested keys', () => {
    const obj = { z: { b: 2, a: 1 }, a: [{ y: 1, x: 2 }] };
    const result = deepCanonicalJson(obj);
    expect(result).toBe('{"a":[{"x":2,"y":1}],"z":{"a":1,"b":2}}');
  });
});
