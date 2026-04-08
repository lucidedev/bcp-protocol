/**
 * BCP COUNTER message — either party proposes modified terms.
 * @module messages/counter
 */

import { PaymentTerms } from './intent';
import { LineItem, EarlyPayDiscount } from './quote';

/** Proposed changes to offer fields */
export interface ProposedChanges {
  /** Modified price */
  price?: number;
  /** Modified currency */
  currency?: string;
  /** Modified payment terms */
  payment_terms?: PaymentTerms;
  /** Modified delivery date (ISO 8601) */
  delivery_date?: string;
  /** Modified line items */
  line_items?: LineItem[];
  /** Modified early payment discount */
  early_pay_discount?: EarlyPayDiscount;
}

/** BCP COUNTER message */
export interface CounterMessage {
  /** Protocol version */
  bcp_version: '0.1';
  /** Message type discriminator */
  message_type: 'COUNTER';
  /** UUID v4 unique counter identifier */
  counter_id: string;
  /** Reference to the quote_id or counter_id being countered */
  ref_id: string;
  /** Which party initiated the counter */
  initiated_by: 'buyer' | 'seller';
  /** ISO 8601 creation timestamp */
  timestamp: string;
  /** Modified offer fields */
  proposed_changes: ProposedChanges;
  /** Optional explanation for the counter */
  rationale?: string;
  /** Validity of this counter (ISO 8601) */
  new_validity_until: string;
  /** Ed25519 hex signature */
  signature: string;
}
