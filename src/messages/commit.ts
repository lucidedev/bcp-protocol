/**
 * BCP COMMIT message — buyer accepts offer and locks escrow.
 * @module messages/commit
 */

import { PaymentTerms } from './intent';

/** Buyer approval details */
export interface BuyerApproval {
  /** Wallet address of the approver */
  approved_by: string;
  /** Whether this approval was autonomous or required human sign-off */
  approval_type: 'autonomous' | 'human_required';
  /** Whether the spending threshold was exceeded */
  threshold_exceeded: boolean;
}

/** Payment schedule */
export interface PaymentSchedule {
  /** Payment schedule type matching payment_terms */
  type: PaymentTerms;
  /** Payment due date (ISO 8601) */
  due_date: string;
}

/** Escrow details */
export interface Escrow {
  /** Amount locked in escrow */
  amount: number;
  /** Currency code */
  currency: string;
  /** Address of the escrow smart contract */
  escrow_contract_address: string;
  /** Condition under which escrow is released */
  release_condition: 'fulfil_confirmed' | 'dispute_timeout_72h';
  /** Payment schedule */
  payment_schedule: PaymentSchedule;
}

/** BCP COMMIT message */
export interface CommitMessage {
  /** Protocol version */
  bcp_version: '0.1';
  /** Message type discriminator */
  message_type: 'COMMIT';
  /** UUID v4 unique commit identifier */
  commit_id: string;
  /** Reference to accepted quote_id or counter_id */
  accepted_ref_id: string;
  /** ISO 8601 creation timestamp */
  timestamp: string;
  /** Approval details */
  buyer_approval: BuyerApproval;
  /** Escrow details */
  escrow: Escrow;
  /** Optional purchase order reference */
  po_reference?: string;
  /** Ed25519 hex signature */
  signature: string;
}
