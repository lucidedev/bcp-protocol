/**
 * On-chain escrow provider — interacts with the BCPEscrow Solidity contract
 * on Base Sepolia via ethers.js.
 *
 * Fully permissionless. No external API accounts required.
 * Just a funded Base Sepolia wallet (private key in .env).
 *
 * @module escrow/onchain-escrow
 */

import { ethers } from 'ethers';
import { CommitMessage } from '../messages/commit';
import { FulfilMessage } from '../messages/fulfil';
import { DisputeMessage } from '../messages/dispute';
import {
  EscrowProvider,
  EscrowReceipt,
  ReleaseReceipt,
  FreezeReceipt,
  UnfreezeApproval,
} from './escrow';

/** Minimal ABI for the BCPEscrow contract (only the functions we call) */
const BCP_ESCROW_ABI = [
  'function lock(bytes32 commitId, address buyer, address seller, uint256 releaseAfter) external payable',
  'function lockToken(bytes32 commitId, address buyer, address seller, uint256 releaseAfter, address token, uint256 amount) external',
  'function release(bytes32 commitId) external',
  'function freeze(bytes32 commitId) external',
  'function approveUnfreeze(bytes32 commitId) external',
  'function getEscrow(bytes32 commitId) external view returns (address buyer, address seller, uint256 amount, uint256 releaseAfter, uint8 status, address token)',
  'event Locked(bytes32 indexed commitId, address buyer, address seller, uint256 amount, uint256 releaseAfter, address token)',
  'event Released(bytes32 indexed commitId, address seller, uint256 amount)',
  'event Frozen(bytes32 indexed commitId, address frozenBy)',
  'event UnfreezeApproved(bytes32 indexed commitId, address approvedBy)',
  'event Unfrozen(bytes32 indexed commitId)',
];

/** Minimal ERC-20 ABI for approve/allowance */
const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function balanceOf(address account) external view returns (uint256)',
];

/** Configuration for the on-chain escrow provider */
export interface OnChainEscrowConfig {
  /** JSON-RPC URL (default: Base Sepolia public RPC) */
  rpcUrl?: string;
  /** Deployed BCPEscrow contract address */
  contractAddress: string;
  /** Buyer's EVM private key (hex, with or without 0x prefix) */
  buyerPrivateKey: string;
  /** Seller's EVM address — used when locking escrow */
  sellerAddress: string;
  /** ERC-20 token address. If set, use lockToken() instead of lock(). address(0) or omitted = native ETH. */
  tokenAddress?: string;
  /** Token decimals (default: 18). Only used when tokenAddress is set. */
  tokenDecimals?: number;
}

/** Base Sepolia public RPC */
const BASE_SEPOLIA_RPC = 'https://sepolia.base.org';

/**
 * Convert a UUID-style commit_id to a bytes32 by keccak256-hashing it.
 */
function commitIdToBytes32(commitId: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(commitId));
}

/**
 * On-chain escrow provider using the BCPEscrow Solidity contract.
 * Supports both native ETH and ERC-20 tokens (e.g. FDUSD).
 */
export class OnChainEscrowProvider implements EscrowProvider {
  private provider: ethers.JsonRpcProvider;
  private buyerWallet: ethers.Wallet;
  private contract: ethers.Contract;
  private sellerAddress: string;
  private contractAddress: string;
  private tokenAddress: string | null;
  private tokenDecimals: number;

  /** Map commit_id → bytes32 hash for reverse lookups */
  private commitMap: Map<string, string> = new Map();

  constructor(config: OnChainEscrowConfig) {
    const rpc = config.rpcUrl || BASE_SEPOLIA_RPC;
    this.provider = new ethers.JsonRpcProvider(rpc);
    this.buyerWallet = new ethers.Wallet(config.buyerPrivateKey, this.provider);
    this.contractAddress = config.contractAddress;
    this.sellerAddress = config.sellerAddress;
    this.tokenAddress = config.tokenAddress || null;
    this.tokenDecimals = config.tokenDecimals ?? 18;
    this.contract = new ethers.Contract(
      config.contractAddress,
      BCP_ESCROW_ABI,
      this.buyerWallet
    );
  }

  async lock(commit: CommitMessage): Promise<EscrowReceipt> {
    const commitHash = commitIdToBytes32(commit.commit_id);
    this.commitMap.set(commit.commit_id, commitHash);

    const releaseAfter = Math.floor(new Date(commit.escrow.payment_schedule.due_date).getTime() / 1000);
    let tx: ethers.ContractTransactionResponse;

    if (this.tokenAddress) {
      // ERC-20 path: approve then lockToken
      const amount = ethers.parseUnits(commit.escrow.amount.toString(), this.tokenDecimals);
      const tokenContract = new ethers.Contract(this.tokenAddress, ERC20_ABI, this.buyerWallet);

      // Check existing allowance — only approve if needed
      const currentAllowance: bigint = await tokenContract.allowance(
        this.buyerWallet.address,
        this.contractAddress
      );
      if (currentAllowance < amount) {
        // Approve max to avoid repeated approve calls
        const approveTx = await tokenContract.approve(
          this.contractAddress,
          ethers.MaxUint256
        );
        await approveTx.wait(1);
      }

      tx = await this.contract.lockToken(
        commitHash,
        this.buyerWallet.address,
        this.sellerAddress,
        releaseAfter,
        this.tokenAddress,
        amount
      );
    } else {
      // Native ETH path
      const valueWei = ethers.parseEther(commit.escrow.amount.toString());
      tx = await this.contract.lock(
        commitHash,
        this.buyerWallet.address,
        this.sellerAddress,
        releaseAfter,
        { value: valueWei }
      );
    }

    const receipt = await tx.wait();

    return {
      escrow_id: commitHash,
      amount: commit.escrow.amount,
      currency: commit.escrow.currency,
      contract_address: this.contractAddress,
      locked_at: new Date().toISOString(),
      status: 'locked',
      tx_hash: receipt!.hash,
    };
  }

  async release(fulfil: FulfilMessage): Promise<ReleaseReceipt> {
    const commitHash = this.commitMap.get(fulfil.commit_id)
      || commitIdToBytes32(fulfil.commit_id);

    // Fetch on-chain data for amount + token
    const data = await this.contract.getEscrow(commitHash);
    const tokenAddr: string = data[5];
    const isToken = tokenAddr !== ethers.ZeroAddress;
    const decimals = isToken ? this.tokenDecimals : 18;
    const amount = Number(ethers.formatUnits(data[2], decimals));
    const currency = isToken ? 'FDUSD' : 'ETH';

    const tx = await this.contract.release(commitHash);
    const receipt = await tx.wait();

    return {
      escrow_id: commitHash,
      amount,
      currency,
      tx_hash: receipt!.hash,
      released_at: new Date().toISOString(),
      status: 'released',
    };
  }

  async freeze(dispute: DisputeMessage): Promise<FreezeReceipt> {
    const commitHash = this.commitMap.get(dispute.commit_id)
      || commitIdToBytes32(dispute.commit_id);

    const data = await this.contract.getEscrow(commitHash);
    const tokenAddr: string = data[5];
    const isToken = tokenAddr !== ethers.ZeroAddress;
    const decimals = isToken ? this.tokenDecimals : 18;
    const amount = Number(ethers.formatUnits(data[2], decimals));

    const tx = await this.contract.freeze(commitHash);
    const receipt = await tx.wait();

    return {
      escrow_id: commitHash,
      amount,
      dispute_id: dispute.dispute_id,
      frozen_at: new Date().toISOString(),
      status: 'frozen',
      tx_hash: receipt!.hash,
    };
  }

  async approveUnfreeze(commitId: string): Promise<UnfreezeApproval> {
    const commitHash = this.commitMap.get(commitId)
      || commitIdToBytes32(commitId);

    const tx = await this.contract.approveUnfreeze(commitHash);
    const receipt = await tx.wait();

    // Check if the Unfrozen event was emitted (both parties approved)
    const unfrozenEvent = receipt!.logs.find(
      (l: ethers.Log) => l.topics[0] === ethers.id('Unfrozen(bytes32)')
    );

    return {
      escrow_id: commitHash,
      approved_by: this.buyerWallet.address === this.sellerAddress ? 'seller' : 'buyer',
      fully_unfrozen: !!unfrozenEvent,
      tx_hash: receipt!.hash,
      approved_at: new Date().toISOString(),
    };
  }

  /**
   * Get the buyer wallet address.
   */
  getBuyerAddress(): string {
    return this.buyerWallet.address;
  }

  /**
   * Get the seller address.
   */
  getSellerAddress(): string {
    return this.sellerAddress;
  }

  /**
   * Create a seller-side instance (for release calls).
   * The seller needs their own private key to call release().
   */
  static createSellerInstance(config: {
    rpcUrl?: string;
    contractAddress: string;
    sellerPrivateKey: string;
    buyerAddress: string;
    tokenAddress?: string;
    tokenDecimals?: number;
  }): OnChainEscrowProvider {
    // Re-use the same class but with the seller's key as the signer
    return new OnChainEscrowProvider({
      rpcUrl: config.rpcUrl,
      contractAddress: config.contractAddress,
      buyerPrivateKey: config.sellerPrivateKey, // signing key
      sellerAddress: config.buyerAddress,       // other party
      tokenAddress: config.tokenAddress,
      tokenDecimals: config.tokenDecimals,
    });
  }
}
