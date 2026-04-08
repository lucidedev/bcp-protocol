/**
 * BCP QUOTE message — seller agent responds with a signed offer.
 * @module messages/quote
 */

import { PaymentTerms } from './intent';

/** Seller identity */
export interface Seller {
  /** Seller organization identifier */
  org_id: string;
  /** Seller agent's wallet address */
  agent_wallet_address: string;
  /** Public key or verifiable credential for the seller agent */
  credential: string;
  /** Seller's EVM address for escrow (optional, set by seller SDK) */
  evm_address?: string;
}

/** A single line item in an offer */
export interface LineItem {
  /** Item description */
  description: string;
  /** Quantity */
  qty: number;
  /** Price per unit */
  unit_price: number;
  /** Unit of measure */
  unit: string;
}

/** Early payment discount terms */
export interface EarlyPayDiscount {
  /** Discount percentage (0-100) */
  discount_percent: number;
  /** Number of days within which payment qualifies for the discount */
  if_paid_within_days: number;
}

/** Commercial offer */
export interface Offer {
  /** Total price */
  price: number;
  /** Currency code (e.g. USDC) */
  currency: string;
  /** Payment terms */
  payment_terms: PaymentTerms;
  /** Expected delivery date (ISO 8601) */
  delivery_date: string;
  /** Quote valid until this timestamp (ISO 8601) */
  validity_until: string;
  /** Line items (min 1) */
  line_items: LineItem[];
  /** Optional early payment discount */
  early_pay_discount?: EarlyPayDiscount;
}

/** BCP QUOTE message */
export interface QuoteMessage {
  /** Protocol version */
  bcp_version: '0.1';
  /** Message type discriminator */
  message_type: 'QUOTE';
  /** UUID v4 unique quote identifier */
  quote_id: string;
  /** Reference to the INTENT */
  intent_id: string;
  /** ISO 8601 creation timestamp */
  timestamp: string;
  /** Seller identity */
  seller: Seller;
  /** The commercial offer */
  offer: Offer;
  /** Ed25519 hex signature */
  signature: string;
}
