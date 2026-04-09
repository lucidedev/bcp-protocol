/**
 * x402-Funded Escrow Provider
 *
 * Bridges x402 (HTTP 402 Payment Required) with BCP on-chain escrow.
 * When a buyer commits to a deal, this provider:
 *
 * 1. Sends the escrow lock request to the seller's x402-enabled endpoint
 * 2. Receives a 402 response with payment parameters
 * 3. Signs an EIP-191 payment proof for the escrow amount
 * 4. The x402 facilitator settles the lock into the BCP escrow contract
 *
 * This unifies the two protocols:
 *   x402 handles the payment rail → BCP handles the commerce lifecycle
 *
 * @module escrow/x402-funded-escrow
 */

import { ethers } from 'ethers';
import type { CommitMessage, FulfilMessage, DisputeMessage } from '../messages/types';
import type {
  EscrowProvider,
  EscrowReceipt,
  ReleaseReceipt,
  FreezeReceipt,
  UnfreezeApproval,
} from './escrow';
import { createLogger } from '../logger';

const log = createLogger('x402-funded-escrow');

// ── Types ──────────────────────────────────────────────────────────

/** Payment details returned in a 402 response body */
interface X402PaymentDetails {
  paymentRequired: {
    amount: string;
    recipient: string;
    token: string;
    network: string;
    escrowContract: string;
    nonce: string;
  };
}

/** Configuration for the x402-funded escrow provider */
export interface X402FundedEscrowConfig {
  /** Seller's x402-enabled escrow endpoint (e.g. https://seller.com/x402/escrow) */
  sellerX402Endpoint: string;
  /** Buyer's EVM private key (hex) for signing payment proofs */
  buyerPrivateKey: string;
  /** Fallback RPC URL for on-chain verification */
  rpcUrl?: string;
  /** Seller's EVM address */
  sellerAddress: string;
  /** BCP escrow contract address */
  contractAddress: string;
  /** Token address (e.g. USDC). Omit for native ETH. */
  tokenAddress?: string;
  /** Token decimals (default: 6 for USDC) */
  tokenDecimals?: number;
}

// ── Provider ───────────────────────────────────────────────────────

/**
 * EscrowProvider that funds escrow locks via x402 payment flow.
 *
 * Lock flow:
 *   1. POST to seller's x402 endpoint → 402 Payment Required
 *   2. Sign EIP-191 payment proof
 *   3. Re-POST with X-PAYMENT header → 200 OK (escrow locked)
 *
 * Release/Freeze/Unfreeze: fall through to direct on-chain calls.
 */
export class X402FundedEscrowProvider implements EscrowProvider {
  private config: X402FundedEscrowConfig;
  private wallet: ethers.Wallet;

  constructor(config: X402FundedEscrowConfig) {
    this.config = config;
    const rpc = config.rpcUrl || 'https://sepolia.base.org';
    const provider = new ethers.JsonRpcProvider(rpc);
    this.wallet = new ethers.Wallet(config.buyerPrivateKey, provider);
  }

  /**
   * Lock escrow via x402 payment flow.
   *
   * Instead of calling the escrow contract directly, the buyer sends
   * the lock request through the seller's x402-protected endpoint.
   * The facilitator (Coinbase, etc.) verifies the payment proof and
   * calls lockToken() on the BCP escrow contract.
   */
  async lock(commit: CommitMessage): Promise<EscrowReceipt> {
    const amount = commit.agreedPrice;
    const currency = commit.currency;
    const endpoint = this.config.sellerX402Endpoint;

    log.info('Initiating x402-funded escrow lock', {
      amount,
      currency,
      endpoint,
      sessionId: commit.sessionId,
    });

    // Step 1: Send lock request → expect 402
    const lockRequest = {
      action: 'escrow_lock',
      session_id: commit.sessionId,
      amount,
      currency,
      buyer: this.wallet.address,
      seller: this.config.sellerAddress,
      escrow_contract: this.config.contractAddress,
    };

    log.debug('Sending initial lock request to x402 endpoint');
    const initialResponse = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lockRequest),
    });

    if (initialResponse.status === 402) {
      // Step 2: Parse 402 payment details
      const paymentDetails = await initialResponse.json() as X402PaymentDetails;
      const pd = paymentDetails.paymentRequired;

      log.debug('Received 402 payment details', {
        amount: pd.amount,
        recipient: pd.recipient,
        network: pd.network,
      });

      // Step 3: Sign EIP-191 payment proof
      const payloadToSign = JSON.stringify({
        action: 'escrow_lock',
        session_id: commit.sessionId,
        amount: pd.amount,
        recipient: pd.recipient,
        token: pd.token || this.config.tokenAddress || 'ETH',
        network: pd.network,
        escrow_contract: pd.escrowContract || this.config.contractAddress,
        nonce: pd.nonce,
        payer: this.wallet.address,
      });

      const signature = await this.wallet.signMessage(payloadToSign);

      // Step 4: Re-send with X-PAYMENT header
      const paymentHeader = Buffer.from(JSON.stringify({
        payload: payloadToSign,
        signature,
        payer: this.wallet.address,
      })).toString('base64');

      log.debug('Re-sending request with X-PAYMENT header');
      const paymentResponse = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PAYMENT': paymentHeader,
        },
        body: JSON.stringify(lockRequest),
      });

      if (paymentResponse.ok) {
        const result = await paymentResponse.json() as {
          txHash: string;
          escrowId: string;
          lockedAmount: string;
        };

        log.info('x402 escrow lock confirmed', {
          txHash: result.txHash,
          sessionId: commit.sessionId,
        });

        return {
          escrow_id: result.escrowId || commit.sessionId,
          amount,
          currency,
          contract_address: this.config.contractAddress,
          locked_at: new Date().toISOString(),
          status: 'locked',
          tx_hash: result.txHash,
        };
      }

      const errorBody = await paymentResponse.text();
      throw new Error(`x402 escrow lock failed: ${paymentResponse.status} — ${errorBody}`);
    }

    // If 200 returned directly (no payment required — e.g. trusted buyer)
    if (initialResponse.ok) {
      const result = await initialResponse.json() as {
        txHash: string;
      };
      return {
        escrow_id: commit.sessionId,
        amount,
        currency,
        contract_address: this.config.contractAddress,
        locked_at: new Date().toISOString(),
        status: 'locked',
        tx_hash: result.txHash || `0x402_trusted_${Date.now().toString(16)}`,
      };
    }

    throw new Error(`Unexpected response from x402 endpoint: ${initialResponse.status}`);
  }

  /**
   * Release escrow — direct on-chain call (post-fulfilment).
   * The x402 layer is only used for funding. Release uses the standard path.
   */
  async release(fulfil: FulfilMessage): Promise<ReleaseReceipt> {
    const commitHash = ethers.keccak256(ethers.toUtf8Bytes(fulfil.sessionId));
    const contract = new ethers.Contract(
      this.config.contractAddress,
      [
        'function release(bytes32 commitId) external',
        'function getEscrow(bytes32 commitId) external view returns (address buyer, address seller, uint256 amount, uint256 releaseAfter, uint8 status, address token)',
      ],
      this.wallet
    );

    const data = await contract.getEscrow(commitHash);
    const tokenAddr: string = data[5];
    const isToken = tokenAddr !== ethers.ZeroAddress;
    const decimals = isToken ? (this.config.tokenDecimals ?? 6) : 18;
    const amount = Number(ethers.formatUnits(data[2], decimals));

    const tx = await contract.release(commitHash);
    const receipt = await tx.wait();

    return {
      escrow_id: commitHash,
      amount,
      currency: isToken ? 'USDC' : 'ETH',
      tx_hash: receipt!.hash,
      released_at: new Date().toISOString(),
      status: 'released',
    };
  }

  /**
   * Freeze escrow — direct on-chain call during dispute.
   */
  async freeze(dispute: DisputeMessage): Promise<FreezeReceipt> {
    const commitHash = ethers.keccak256(ethers.toUtf8Bytes(dispute.sessionId));
    const contract = new ethers.Contract(
      this.config.contractAddress,
      [
        'function freeze(bytes32 commitId) external',
        'function getEscrow(bytes32 commitId) external view returns (address buyer, address seller, uint256 amount, uint256 releaseAfter, uint8 status, address token)',
      ],
      this.wallet
    );

    const data = await contract.getEscrow(commitHash);
    const tokenAddr: string = data[5];
    const isToken = tokenAddr !== ethers.ZeroAddress;
    const decimals = isToken ? (this.config.tokenDecimals ?? 6) : 18;
    const amount = Number(ethers.formatUnits(data[2], decimals));

    const tx = await contract.freeze(commitHash);
    const receipt = await tx.wait();

    return {
      escrow_id: commitHash,
      amount,
      sessionId: dispute.sessionId,
      frozen_at: new Date().toISOString(),
      status: 'frozen',
      tx_hash: receipt!.hash,
    };
  }

  /**
   * Approve unfreeze — direct on-chain call (2-of-2 multisig).
   */
  async approveUnfreeze(sessionId: string): Promise<UnfreezeApproval> {
    const commitHash = ethers.keccak256(ethers.toUtf8Bytes(sessionId));
    const contract = new ethers.Contract(
      this.config.contractAddress,
      [
        'function approveUnfreeze(bytes32 commitId) external',
        'function getEscrow(bytes32 commitId) external view returns (address buyer, address seller, uint256 amount, uint256 releaseAfter, uint8 status, address token)',
      ],
      this.wallet
    );

    const tx = await contract.approveUnfreeze(commitHash);
    const receipt = await tx.wait();

    // Check if fully unfrozen (status 1 = Locked, meaning back from Frozen)
    const escrow = await contract.getEscrow(commitHash);
    const fullyUnfrozen = Number(escrow[4]) === 1; // Status.Locked

    return {
      escrow_id: commitHash,
      approved_by: 'buyer',
      fully_unfrozen: fullyUnfrozen,
      tx_hash: receipt!.hash,
      approved_at: new Date().toISOString(),
    };
  }
}
