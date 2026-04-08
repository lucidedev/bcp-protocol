/**
 * BCP DISPUTE message — either party freezes escrow and raises an issue.
 * @module messages/dispute
 */

/** BCP DISPUTE message */
export interface DisputeMessage {
  /** Protocol version */
  bcp_version: '0.1';
  /** Message type discriminator */
  message_type: 'DISPUTE';
  /** UUID v4 unique dispute identifier */
  dispute_id: string;
  /** Reference to the COMMIT under dispute */
  commit_id: string;
  /** ISO 8601 creation timestamp */
  timestamp: string;
  /** Which party raised the dispute */
  raised_by: 'buyer' | 'seller';
  /** Reason for the dispute */
  reason: 'partial_delivery' | 'non_delivery' | 'quality_issue' | 'payment_failure' | 'other';
  /** Optional SHA-256 hash of evidence */
  evidence_hash?: string;
  /** Optional URL to evidence */
  evidence_url?: string;
  /** Resolution requested by the disputing party */
  requested_resolution: 'full_refund' | 'partial_refund' | 'redeliver' | 'negotiate';
  /** Ed25519 hex signature */
  signature: string;
}
