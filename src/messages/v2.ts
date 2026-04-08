/**
 * BCP v0.2 Message Types
 *
 * Lean message definitions — only the fields the state machine needs.
 * Signatures and escrow are optional (pluggable auth + settlement).
 *
 * @module messages/v2
 */

// ── Auth + Settlement ──────────────────────────────────────────────

/** Authentication mode for a session */
export type AuthMode = 'none' | 'platform' | 'ed25519';

/** Settlement profile agreed between parties */
export type Settlement = 'none' | 'invoice' | 'x402' | 'escrow';

// ── Common envelope fields ─────────────────────────────────────────

/** Fields present on every BCP v0.2 message */
export interface BCPEnvelope {
  /** Protocol version */
  bcp_version: '0.2';
  /** Message type */
  type: 'intent' | 'quote' | 'counter' | 'commit' | 'fulfil' | 'dispute';
  /** Session identifier — set by buyer in INTENT, reused throughout */
  sessionId: string;
  /** ISO 8601 creation timestamp */
  timestamp: string;
  /** URL for async response delivery */
  callbackUrl?: string;
  /** Ed25519 hex signature (required when auth is ed25519) */
  signature?: string;
}

// ── Message Types ──────────────────────────────────────────────────

/** Buyer declares what they need */
export interface IntentMessageV2 extends BCPEnvelope {
  type: 'intent';
  /** What the buyer needs, in natural language */
  service: string;
  /** Maximum budget */
  budget?: number;
  /** Currency code (default: USD) */
  currency?: string;
  /** Auth mode for this session */
  auth?: AuthMode;
  /** Shared ID for multi-seller RFQ broadcasts */
  rfqId?: string;
}

/** Seller responds with pricing */
export interface QuoteMessageV2 extends BCPEnvelope {
  type: 'quote';
  /** Offered price */
  price: number;
  /** Currency code */
  currency: string;
  /** What the buyer will receive */
  deliverables?: string[];
  /** Estimated delivery time in days */
  estimatedDays?: number;
  /** Quote expiry (ISO 8601) */
  validUntil?: string;
  /** Proposed settlement method */
  settlement?: Settlement;
}

/** Either party proposes different terms */
export interface CounterMessageV2 extends BCPEnvelope {
  type: 'counter';
  /** Proposed price */
  counterPrice: number;
  /** Reason for the counter */
  reason?: string;
}

/** Buyer accepts and hires the seller */
export interface CommitMessageV2 extends BCPEnvelope {
  type: 'commit';
  /** The price being committed to */
  agreedPrice: number;
  /** Currency code */
  currency: string;
  /** Agreed settlement method */
  settlement?: Settlement;
  /** Escrow details (only when settlement is 'escrow') */
  escrow?: {
    contractAddress: string;
    txHash?: string;
  };
}

/** Seller confirms delivery */
export interface FulfilMessageV2 extends BCPEnvelope {
  type: 'fulfil';
  /** What was delivered */
  deliverables?: string[];
  /** Summary of work done */
  summary?: string;
  /** SHA-256 hash of delivery evidence */
  proofHash?: string;
  /** URL to a formal invoice */
  invoiceUrl?: string;
}

/** Either party flags a problem */
export interface DisputeMessageV2 extends BCPEnvelope {
  type: 'dispute';
  /** What went wrong */
  reason: string;
  /** Requested resolution */
  resolution?: 'refund' | 'redeliver' | 'negotiate';
}

// ── Union type ─────────────────────────────────────────────────────

/** Any BCP v0.2 message */
export type BCPMessageV2 =
  | IntentMessageV2
  | QuoteMessageV2
  | CounterMessageV2
  | CommitMessageV2
  | FulfilMessageV2
  | DisputeMessageV2;
