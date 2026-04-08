/**
 * BCP FULFIL message — seller confirms delivery and triggers escrow release.
 * @module messages/fulfil
 */

/** Delivery proof */
export interface DeliveryProof {
  /** Type of delivery proof */
  type: 'api_verified' | 'hash' | 'delivery_receipt' | 'service_confirmation';
  /** Evidence of delivery (hash, URL, receipt ID, etc.) */
  evidence: string;
}

/** Invoice details */
export interface Invoice {
  /** Invoice format — always UBL 2.1 */
  format: 'UBL2.1';
  /** Unique invoice identifier */
  invoice_id: string;
  /** SHA-256 hash of the UBL invoice XML */
  invoice_hash: string;
  /** URL where the UBL invoice can be retrieved */
  invoice_url: string;
}

/** BCP FULFIL message */
export interface FulfilMessage {
  /** Protocol version */
  bcp_version: '0.1';
  /** Message type discriminator */
  message_type: 'FULFIL';
  /** UUID v4 unique fulfilment identifier */
  fulfil_id: string;
  /** Reference to the COMMIT being fulfilled */
  commit_id: string;
  /** ISO 8601 creation timestamp */
  timestamp: string;
  /** Proof of delivery */
  delivery_proof: DeliveryProof;
  /** Invoice details */
  invoice: Invoice;
  /** When to trigger settlement via x402 */
  settlement_trigger: 'immediate' | 'scheduled';
  /** On-chain tx hash for escrow release (set by seller after release) */
  release_tx_hash?: string;
  /** Ed25519 hex signature */
  signature: string;
}
