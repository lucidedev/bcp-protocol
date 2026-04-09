/**
 * DID Key Utilities — convert between BCP hex Ed25519 keys and did:key format.
 *
 * The A2A ecosystem (APS, AgentID, TrustChain) uses did:key identifiers.
 * BCP uses raw Ed25519 hex public keys. This module bridges the two.
 *
 * Format: did:key:z6Mk... = multibase(base58btc) + multicodec(ed25519-pub [0xed, 0x01]) + raw key bytes
 *
 * @module identity/did
 */

// ── Base58btc alphabet (Bitcoin) ───────────────────────────────────

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58btcEncode(bytes: Uint8Array): string {
  // Count leading zeros
  let zeros = 0;
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) zeros++;

  // Convert to big integer
  let num = BigInt(0);
  for (const byte of bytes) {
    num = num * BigInt(256) + BigInt(byte);
  }

  // Encode
  const chars: string[] = [];
  while (num > BigInt(0)) {
    const remainder = Number(num % BigInt(58));
    chars.unshift(ALPHABET[remainder]);
    num = num / BigInt(58);
  }

  // Add leading '1' for each leading zero byte
  for (let i = 0; i < zeros; i++) chars.unshift('1');

  return chars.join('');
}

function base58btcDecode(str: string): Uint8Array {
  // Count leading '1's
  let zeros = 0;
  for (let i = 0; i < str.length && str[i] === '1'; i++) zeros++;

  // Decode from base58
  let num = BigInt(0);
  for (const char of str) {
    const idx = ALPHABET.indexOf(char);
    if (idx === -1) throw new Error(`Invalid base58 character: ${char}`);
    num = num * BigInt(58) + BigInt(idx);
  }

  // Convert to bytes
  const hex = num.toString(16).padStart(2, '0');
  const paddedHex = hex.length % 2 ? '0' + hex : hex;
  const bytes = new Uint8Array(paddedHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(paddedHex.slice(i * 2, i * 2 + 2), 16);
  }

  // Prepend zero bytes
  const result = new Uint8Array(zeros + bytes.length);
  result.set(bytes, zeros);
  return result;
}

// ── Ed25519 multicodec prefix ──────────────────────────────────────

/** Multicodec varint for ed25519-pub: 0xed 0x01 */
const ED25519_MULTICODEC = new Uint8Array([0xed, 0x01]);

// ── Public API ─────────────────────────────────────────────────────

/**
 * Convert a raw Ed25519 public key (hex) to a did:key identifier.
 *
 * @param publicKeyHex - 64-char hex string (32 bytes)
 * @returns did:key:z6Mk... string
 *
 * @example
 * ```ts
 * const did = toDIDKey('d75a980182b10ab7d54bfed3c964073a0ee172f3daa3f4a18446b7e8c6770d72');
 * // did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK
 * ```
 */
export function toDIDKey(publicKeyHex: string): string {
  const cleanHex = publicKeyHex.startsWith('0x') ? publicKeyHex.slice(2) : publicKeyHex;
  if (cleanHex.length !== 64) {
    throw new Error(`Expected 64-char hex public key, got ${cleanHex.length} chars`);
  }

  // Convert hex to bytes
  const keyBytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    keyBytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
  }

  // Prepend multicodec prefix
  const multicodecKey = new Uint8Array(ED25519_MULTICODEC.length + keyBytes.length);
  multicodecKey.set(ED25519_MULTICODEC);
  multicodecKey.set(keyBytes, ED25519_MULTICODEC.length);

  // Encode as base58btc with 'z' multibase prefix
  return `did:key:z${base58btcEncode(multicodecKey)}`;
}

/**
 * Extract the raw Ed25519 public key (hex) from a did:key identifier.
 *
 * @param didKey - did:key:z6Mk... string
 * @returns 64-char hex string (32 bytes)
 *
 * @example
 * ```ts
 * const hex = fromDIDKey('did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK');
 * // 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa3f4a18446b7e8c6770d72'
 * ```
 */
export function fromDIDKey(didKey: string): string {
  if (!didKey.startsWith('did:key:z')) {
    throw new Error('Expected did:key with z (base58btc) multibase prefix');
  }

  // Strip 'did:key:z' prefix
  const base58str = didKey.slice('did:key:z'.length);
  const decoded = base58btcDecode(base58str);

  // Verify multicodec prefix
  if (decoded.length < 2 || decoded[0] !== 0xed || decoded[1] !== 0x01) {
    throw new Error('Not an ed25519-pub multicodec key');
  }

  // Extract raw key bytes
  const keyBytes = decoded.slice(2);
  if (keyBytes.length !== 32) {
    throw new Error(`Expected 32 key bytes, got ${keyBytes.length}`);
  }

  return Array.from(keyBytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Check if a string is a valid did:key identifier for an Ed25519 key.
 */
export function isDIDKey(value: string): boolean {
  try {
    fromDIDKey(value);
    return true;
  } catch {
    return false;
  }
}
