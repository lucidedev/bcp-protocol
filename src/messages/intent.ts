/**
 * BCP INTENT message — buyer agent declares a procurement need.
 * @module messages/intent
 */

/** Buyer identity and authorization */
export interface Buyer {
  /** Buyer organization identifier */
  org_id: string;
  /** Buyer agent's wallet address (0x-prefixed hex for EVM) */
  agent_wallet_address: string;
  /** Public key or verifiable credential for the buyer agent */
  credential: string;
  /** Maximum amount the buyer agent is authorized to spend */
  spending_limit: number;
  /** Currency code (e.g. USDC, USDT) */
  currency: string;
}

/** Procurement requirements */
export interface Requirements {
  /** Product/service category */
  category: string;
  /** Quantity required */
  quantity: number;
  /** Desired delivery window as ISO 8601 duration or date range */
  delivery_window: string;
  /** Maximum budget for this procurement */
  budget_max: number;
  /** Payment terms the buyer is willing to accept */
  payment_terms_acceptable: PaymentTerms[];
  /** Compliance requirements (e.g. ISO certifications) */
  compliance?: string[];
}

/** Valid payment terms */
export type PaymentTerms = 'immediate' | 'net15' | 'net30' | 'net45' | 'net60' | 'net90';

/** BCP INTENT message */
export interface IntentMessage {
  /** Protocol version */
  bcp_version: '0.1';
  /** Message type discriminator */
  message_type: 'INTENT';
  /** UUID v4 unique identifier for this intent */
  intent_id: string;
  /** ISO 8601 creation timestamp */
  timestamp: string;
  /** Buyer identity and authorization */
  buyer: Buyer;
  /** Procurement requirements */
  requirements: Requirements;
  /** Time to live in seconds */
  ttl: number;
  /**
   * UUID v4 identifier for the RFQ broadcast this INTENT belongs to.
   * When present, signals that this INTENT is part of a multi-seller RFQ.
   * Multiple INTENT messages sharing the same rfq_id are parallel solicitations.
   */
  rfq_id?: string;
  /** Ed25519 hex signature */
  signature: string;
}
