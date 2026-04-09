/**
 * BCP Message Types
 *
 * 7 lean message types for agent-to-agent commerce.
 * Only the fields the state machine needs — everything else is optional.
 *
 * @module messages/types
 */

// ── Auth + Settlement ──────────────────────────────────────────────

/** Authentication mode for a session */
export type AuthMode = 'none' | 'platform' | 'ed25519' | 'did';

/** Settlement profile agreed between parties */
export type Settlement = 'none' | 'invoice' | 'x402' | 'escrow';

// ── Common envelope fields ─────────────────────────────────────────

/** Fields present on every BCP message */
export interface BCPEnvelope {
  /** Protocol version */
  bcp_version: '0.3';
  /** Message type */
  type: 'intent' | 'quote' | 'counter' | 'commit' | 'fulfil' | 'accept' | 'dispute';
  /** Session identifier — set by buyer in INTENT, reused throughout */
  sessionId: string;
  /** ISO 8601 creation timestamp */
  timestamp: string;
  /** URL for async response delivery */
  callbackUrl?: string;
  /** Ed25519 hex signature (required when auth is ed25519 or did) */
  signature?: string;
  /** DID identifier of the sender (e.g. did:key:z6Mk...) */
  did?: string;
}

// ── Message Types ──────────────────────────────────────────────────

/** Buyer declares what they need */
export interface IntentMessage extends BCPEnvelope {
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
  /** Seller's A2A Agent Card URL (for discovery) */
  agentUrl?: string;
}

/** Seller responds with pricing */
export interface QuoteMessage extends BCPEnvelope {
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
export interface CounterMessage extends BCPEnvelope {
  type: 'counter';
  /** Proposed price */
  counterPrice: number;
  /** Reason for the counter */
  reason?: string;
}

/** Buyer accepts and hires the seller */
export interface CommitMessage extends BCPEnvelope {
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
export interface FulfilMessage extends BCPEnvelope {
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

/** Buyer confirms receipt — bilateral receipt for trust records */
export interface AcceptMessage extends BCPEnvelope {
  type: 'accept';
  /** SHA-256 hash of the FULFIL message being accepted */
  fulfilHash?: string;
  /** Optional buyer rating (1-5) */
  rating?: number;
  /** Optional buyer feedback */
  feedback?: string;
}

/** Either party flags a problem */
export interface DisputeMessage extends BCPEnvelope {
  type: 'dispute';
  /** What went wrong */
  reason: string;
  /** Requested resolution */
  resolution?: 'refund' | 'redeliver' | 'negotiate';
}

// ── Union type ─────────────────────────────────────────────────────

/** Any BCP message */
export type BCPMessage =
  | IntentMessage
  | QuoteMessage
  | CounterMessage
  | CommitMessage
  | FulfilMessage
  | AcceptMessage
  | DisputeMessage;
