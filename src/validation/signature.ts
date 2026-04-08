/**
 * Ed25519 signing and verification for BCP messages.
 * Uses @noble/ed25519 for all cryptographic operations.
 * @module validation/signature
 */

import * as ed from '@noble/ed25519';

// Configure noble/ed25519 to use Node.js built-in crypto for sha512
import { createHash } from 'crypto';
ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = createHash('sha512');
  for (const msg of m) h.update(msg);
  return new Uint8Array(h.digest());
};

/**
 * Produce canonical JSON from an object — keys sorted lexicographically, no whitespace.
 * @param obj - The object to serialize
 * @returns Canonical JSON string
 */
export function canonicalJson(obj: Record<string, unknown>): string {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

/**
 * Deep-sort all keys in an object recursively for canonical serialization.
 * @param obj - The value to sort
 * @returns The value with all object keys sorted
 */
function deepSortKeys(obj: unknown): unknown {
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(deepSortKeys);
  }
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
    sorted[key] = deepSortKeys((obj as Record<string, unknown>)[key]);
  }
  return sorted;
}

/**
 * Produce a canonical JSON string with deeply sorted keys.
 * @param obj - The object to serialize
 * @returns Canonical JSON string with all nested keys sorted
 */
export function deepCanonicalJson(obj: Record<string, unknown>): string {
  return JSON.stringify(deepSortKeys(obj));
}

/**
 * Remove the signature field from a message and return the canonical JSON payload.
 * @param message - The BCP message object
 * @returns Canonical JSON string of the message without the signature field
 */
export function getSigningPayload(message: Record<string, unknown>): string {
  const { signature: _, ...rest } = message;
  return deepCanonicalJson(rest);
}

/**
 * Sign a BCP message payload with an Ed25519 private key.
 * @param message - The BCP message object (signature field will be ignored)
 * @param privateKey - Ed25519 private key as hex string or Uint8Array
 * @returns Hex-encoded Ed25519 signature
 */
export function signMessage(
  message: Record<string, unknown>,
  privateKey: string | Uint8Array
): string {
  const payload = getSigningPayload(message);
  const msgBytes = new TextEncoder().encode(payload);
  const privKeyBytes = typeof privateKey === 'string'
    ? hexToBytes(privateKey)
    : privateKey;
  const sig = ed.sign(msgBytes, privKeyBytes);
  return bytesToHex(sig);
}

/**
 * Verify the Ed25519 signature on a BCP message.
 * @param message - The BCP message object (must include signature field)
 * @param publicKey - Ed25519 public key as hex string or Uint8Array
 * @returns true if the signature is valid, false otherwise
 */
export function verifyMessage(
  message: Record<string, unknown>,
  publicKey: string | Uint8Array
): boolean {
  const signatureHex = message.signature as string;
  if (!signatureHex) return false;

  const payload = getSigningPayload(message);
  const msgBytes = new TextEncoder().encode(payload);
  const sigBytes = hexToBytes(signatureHex);
  const pubKeyBytes = typeof publicKey === 'string'
    ? hexToBytes(publicKey)
    : publicKey;

  return ed.verify(sigBytes, msgBytes, pubKeyBytes);
}

/**
 * Generate an Ed25519 keypair.
 * @returns Object with privateKey and publicKey as hex strings
 */
export function generateKeypair(): { privateKey: string; publicKey: string } {
  const privateKey = ed.utils.randomPrivateKey();
  const publicKey = ed.getPublicKey(privateKey);
  return {
    privateKey: bytesToHex(privateKey),
    publicKey: bytesToHex(publicKey),
  };
}

/**
 * Derive the public key from a private key.
 * @param privateKey - Ed25519 private key as hex string
 * @returns Public key as hex string
 */
export function getPublicKey(privateKey: string): string {
  return bytesToHex(ed.getPublicKey(hexToBytes(privateKey)));
}

/**
 * Convert a hex string to Uint8Array.
 * @param hex - Hex-encoded string
 * @returns Byte array
 */
function hexToBytes(hex: string): Uint8Array {
  const len = hex.length;
  const bytes = new Uint8Array(len / 2);
  for (let i = 0; i < len; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Convert a Uint8Array to hex string.
 * @param bytes - Byte array
 * @returns Hex-encoded string
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
