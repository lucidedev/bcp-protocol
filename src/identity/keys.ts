/**
 * Identity module — Ed25519 keypair management via .env files.
 *
 * Fully permissionless. No wallet provider, no external API.
 * Keys are stored as hex strings in a .env file and loaded via dotenv.
 *
 * On first run, if keys are missing, generates fresh keypairs and
 * writes them to .env. Each agent (buyer/seller) has:
 *   - Ed25519 keypair for BCP message signing
 *   - EVM private key for on-chain escrow and x402 payments
 *
 * @module identity/keys
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { randomBytes } from 'crypto';
import { generateKeypair } from '../validation/signature';
import { ethers } from 'ethers';
import { createLogger } from '../logger';

const log = createLogger('identity');

/** Identity for a BCP agent */
export interface AgentIdentity {
  /** Organization ID */
  orgId: string;
  /** Ed25519 private key (hex) — for signing BCP messages */
  ed25519PrivateKey: string;
  /** Ed25519 public key (hex) — for verifying BCP messages */
  ed25519PublicKey: string;
  /** EVM private key (hex with 0x prefix) — for escrow & x402 */
  evmPrivateKey: string;
  /** EVM address (derived from evmPrivateKey) */
  evmAddress: string;
}

/**
 * Load or generate agent identities from a .env file.
 *
 * Expected .env variables:
 *   BUYER_ORG_ID, BUYER_ED25519_PRIVATE_KEY, BUYER_EVM_PRIVATE_KEY
 *   SELLER_ORG_ID, SELLER_ED25519_PRIVATE_KEY, SELLER_EVM_PRIVATE_KEY
 *   BCP_ESCROW_CONTRACT_ADDRESS
 *   BASE_SEPOLIA_RPC_URL (optional)
 *
 * If any keys are missing, generates them and appends to the .env file.
 *
 * @param envPath - Path to the .env file (default: .env in cwd)
 * @returns Object with buyer and seller identities
 */
export function loadIdentities(envPath?: string): {
  buyer: AgentIdentity;
  seller: AgentIdentity;
  escrowContractAddress: string;
  rpcUrl: string;
} {
  const resolvedPath = envPath || path.resolve(process.cwd(), '.env');

  // Load existing .env if it exists
  if (fs.existsSync(resolvedPath)) {
    dotenv.config({ path: resolvedPath });
  }

  const additions: string[] = [];

  // Buyer identity
  const buyerOrgId = process.env.BUYER_ORG_ID || 'acme-corp';
  if (!process.env.BUYER_ORG_ID) additions.push(`BUYER_ORG_ID=${buyerOrgId}`);

  let buyerEd25519Priv = process.env.BUYER_ED25519_PRIVATE_KEY;
  let buyerEd25519Pub = process.env.BUYER_ED25519_PUBLIC_KEY;
  if (!buyerEd25519Priv) {
    const kp = generateKeypair();
    buyerEd25519Priv = kp.privateKey;
    buyerEd25519Pub = kp.publicKey;
    additions.push(`BUYER_ED25519_PRIVATE_KEY=${buyerEd25519Priv}`);
    additions.push(`BUYER_ED25519_PUBLIC_KEY=${buyerEd25519Pub}`);
  }
  if (!buyerEd25519Pub) {
    // Derive from private key
    const { getPublicKey } = require('../validation/signature');
    buyerEd25519Pub = getPublicKey(buyerEd25519Priv!);
    additions.push(`BUYER_ED25519_PUBLIC_KEY=${buyerEd25519Pub}`);
  }

  let buyerEvmPriv = process.env.BUYER_EVM_PRIVATE_KEY;
  if (!buyerEvmPriv) {
    buyerEvmPriv = '0x' + randomBytes(32).toString('hex');
    additions.push(`BUYER_EVM_PRIVATE_KEY=${buyerEvmPriv}`);
  }

  // Seller identity
  const sellerOrgId = process.env.SELLER_ORG_ID || 'widgets-inc';
  if (!process.env.SELLER_ORG_ID) additions.push(`SELLER_ORG_ID=${sellerOrgId}`);

  let sellerEd25519Priv = process.env.SELLER_ED25519_PRIVATE_KEY;
  let sellerEd25519Pub = process.env.SELLER_ED25519_PUBLIC_KEY;
  if (!sellerEd25519Priv) {
    const kp = generateKeypair();
    sellerEd25519Priv = kp.privateKey;
    sellerEd25519Pub = kp.publicKey;
    additions.push(`SELLER_ED25519_PRIVATE_KEY=${sellerEd25519Priv}`);
    additions.push(`SELLER_ED25519_PUBLIC_KEY=${sellerEd25519Pub}`);
  }
  if (!sellerEd25519Pub) {
    const { getPublicKey } = require('../validation/signature');
    sellerEd25519Pub = getPublicKey(sellerEd25519Priv!);
    additions.push(`SELLER_ED25519_PUBLIC_KEY=${sellerEd25519Pub}`);
  }

  let sellerEvmPriv = process.env.SELLER_EVM_PRIVATE_KEY;
  if (!sellerEvmPriv) {
    sellerEvmPriv = '0x' + randomBytes(32).toString('hex');
    additions.push(`SELLER_EVM_PRIVATE_KEY=${sellerEvmPriv}`);
  }

  // Escrow contract
  const escrowContractAddress = process.env.BCP_ESCROW_CONTRACT_ADDRESS || '';
  if (!process.env.BCP_ESCROW_CONTRACT_ADDRESS) {
    additions.push(`BCP_ESCROW_CONTRACT_ADDRESS=`);
  }

  // RPC URL
  const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org';
  if (!process.env.BASE_SEPOLIA_RPC_URL) {
    additions.push(`BASE_SEPOLIA_RPC_URL=${rpcUrl}`);
  }

  // Append generated values to .env
  if (additions.length > 0) {
    const header = fs.existsSync(resolvedPath) ? '\n' : '# BCP Agent Identity — auto-generated\n# Fund these EVM wallets with Base Sepolia ETH to use on-chain escrow.\n\n';
    fs.appendFileSync(resolvedPath, header + additions.join('\n') + '\n');
    log.info(`Generated ${additions.length} missing keys`, { path: resolvedPath });
  }

  const buyerWallet = new ethers.Wallet(buyerEvmPriv!);
  const sellerWallet = new ethers.Wallet(sellerEvmPriv!);

  return {
    buyer: {
      orgId: buyerOrgId,
      ed25519PrivateKey: buyerEd25519Priv!,
      ed25519PublicKey: buyerEd25519Pub!,
      evmPrivateKey: buyerEvmPriv!,
      evmAddress: buyerWallet.address,
    },
    seller: {
      orgId: sellerOrgId,
      ed25519PrivateKey: sellerEd25519Priv!,
      ed25519PublicKey: sellerEd25519Pub!,
      evmPrivateKey: sellerEvmPriv!,
      evmAddress: sellerWallet.address,
    },
    escrowContractAddress,
    rpcUrl,
  };
}
