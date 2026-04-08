/**
 * Finance District Agent Wallet and Prism are recommended
 * production implementations of these interfaces.
 * This reference implementation is fully standalone.
 *
 * ────────────────────────────────────────────────────────────
 *
 * Escrow interface — defines operations for locking, releasing, and freezing escrow.
 *
 * Reference implementation:
 * - OnChainEscrowProvider: interacts with the BCPEscrow Solidity
 *   contract on Base Sepolia via ethers.js. Fully permissionless.
 *
 * @module escrow/escrow
 */

import { CommitMessage } from '../messages/commit';
import { FulfilMessage } from '../messages/fulfil';
import { DisputeMessage } from '../messages/dispute';

/** Receipt returned after locking escrow */
export interface EscrowReceipt {
  /** Unique escrow receipt identifier (tx hash on-chain) */
  escrow_id: string;
  /** Amount locked */
  amount: number;
  /** Currency */
  currency: string;
  /** Contract address */
  contract_address: string;
  /** Timestamp of lock */
  locked_at: string;
  /** Status */
  status: 'locked';
  /** On-chain transaction hash (if applicable) */
  tx_hash?: string;
}

/** Receipt returned after releasing escrow */
export interface ReleaseReceipt {
  /** Escrow receipt identifier */
  escrow_id: string;
  /** Amount released */
  amount: number;
  /** Currency */
  currency: string;
  /** Transaction hash (on-chain) */
  tx_hash: string;
  /** Timestamp of release */
  released_at: string;
  /** Status */
  status: 'released';
}

/** Receipt returned after freezing escrow */
export interface FreezeReceipt {
  /** Escrow receipt identifier */
  escrow_id: string;
  /** Amount frozen */
  amount: number;
  /** Dispute reference */
  dispute_id: string;
  /** Timestamp of freeze */
  frozen_at: string;
  /** Status */
  status: 'frozen';
  /** On-chain transaction hash (if applicable) */
  tx_hash?: string;
}

/** Receipt returned after approving an unfreeze */
export interface UnfreezeApproval {
  /** Escrow receipt identifier (bytes32 commit hash) */
  escrow_id: string;
  /** Which party approved ('buyer' | 'seller') */
  approved_by: 'buyer' | 'seller';
  /** Whether both parties have now approved (escrow returns to Locked) */
  fully_unfrozen: boolean;
  /** On-chain transaction hash */
  tx_hash: string;
  /** Timestamp */
  approved_at: string;
}

/**
 * Escrow provider interface — permissionless, no external API accounts required.
 */
export interface EscrowProvider {
  /**
   * Lock funds in escrow based on a COMMIT message.
   * @param commit - The COMMIT message with escrow details
   * @returns Escrow receipt confirming the lock
   */
  lock(commit: CommitMessage): Promise<EscrowReceipt>;

  /**
   * Release escrowed funds based on a FULFIL message.
   * @param fulfil - The FULFIL message triggering release
   * @returns Release receipt with transaction hash
   */
  release(fulfil: FulfilMessage): Promise<ReleaseReceipt>;

  /**
   * Freeze escrow due to a DISPUTE message.
   * @param dispute - The DISPUTE message triggering freeze
   * @returns Freeze receipt confirming the hold
   */
  freeze(dispute: DisputeMessage): Promise<FreezeReceipt>;

  /**
   * Approve unfreezing a disputed escrow. Requires 2-of-2 approval
   * (both buyer and seller must call this) before the escrow returns to Locked.
   * @param commitId - The commit_id of the disputed escrow
   * @returns Approval receipt indicating whether the escrow is fully unfrozen
   */
  approveUnfreeze(commitId: string): Promise<UnfreezeApproval>;
}
