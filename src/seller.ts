/**
 * BCP Seller SDK — listen for buyer messages and respond using lean v0.3 messages.
 *
 * @module seller
 */

import { v4 as uuidv4 } from 'uuid';
import { ethers } from 'ethers';
import type {
  IntentMessage,
  QuoteMessage,
  CommitMessage,
  FulfilMessage,
  CounterMessage,
  DisputeMessage,
  BCPMessage,
} from './messages/types';
import { SessionManager } from './state/session';
import { OnChainEscrowProvider } from './escrow/onchain-escrow';
import { createBCPServer, MessageHandler } from './transport/server';
import { signMessage } from './validation/signature';
import { generateKeypair } from './validation/signature';
import { createLogger, configureLogger, LogLevel } from './logger';
import { NETWORKS, NetworkConfig } from './buyer';

const log = createLogger('seller');

// ── Config types ───────────────────────────────────────────────────

export interface BCPSellerConfig {
  network: string;
  evmPrivateKey?: string;
  contractAddress?: string;
  ed25519?: { privateKey: string; publicKey: string };
  tokenAddress?: string;
  tokenDecimals?: number;
  logLevel?: LogLevel;
}

export type PricingStrategy = (intent: IntentMessage) => { price: number; description?: string };

export interface SellerListenOptions {
  port?: number;
  pricing?: PricingStrategy;
  markupPercent?: number;
  autoAcceptCounters?: boolean;
  onDealComplete?: (result: SellerDealResult) => void;
  onDisputeReceived?: (dispute: DisputeMessage) => void;
}

export interface SellerDealResult {
  sessionId: string;
  price: number;
  currency: string;
  releaseTxHash?: string;
}

// ── Seller SDK ─────────────────────────────────────────────────────

export class BCPSeller {
  private networkConfig: NetworkConfig;
  private contractAddress: string;
  private evmKey: string;
  private ed25519: { privateKey: string; publicKey: string };
  private explorerUrl: string;
  private tokenAddress: string;
  private tokenDecimals: number;

  constructor(config: BCPSellerConfig) {
    const net = NETWORKS[config.network];
    if (!net && !config.network.startsWith('http')) {
      throw new Error(`Unknown network "${config.network}". Use: ${Object.keys(NETWORKS).join(', ')}`);
    }
    this.networkConfig = net || {
      chainId: 0, rpcUrl: config.network,
      usdcAddress: config.tokenAddress || '', usdcDecimals: config.tokenDecimals || 6, explorerUrl: '',
    };

    this.evmKey = config.evmPrivateKey || process.env.SELLER_EVM_PRIVATE_KEY || '';
    if (!this.evmKey) throw new Error('Missing seller EVM key.');

    this.contractAddress = config.contractAddress || process.env.BCP_ESCROW_CONTRACT_ADDRESS || '';
    if (!this.contractAddress) throw new Error('Missing escrow contract address.');

    this.tokenAddress = config.tokenAddress || this.networkConfig.usdcAddress;
    this.tokenDecimals = config.tokenDecimals ?? this.networkConfig.usdcDecimals;
    this.explorerUrl = this.networkConfig.explorerUrl;

    this.ed25519 = config.ed25519 || (() => {
      const pk = process.env.SELLER_ED25519_PRIVATE_KEY;
      const pub = process.env.SELLER_ED25519_PUBLIC_KEY;
      return pk && pub ? { privateKey: pk, publicKey: pub } : generateKeypair();
    })();

    configureLogger({ level: config.logLevel ?? LogLevel.INFO });
  }

  get address(): string { return new ethers.Wallet(this.evmKey).address; }
  get publicKey(): string { return this.ed25519.publicKey; }

  /**
   * Start listening for incoming BCP messages.
   * Handles: intent→quote, counter→revised quote, commit→fulfil.
   */
  listen(options: SellerListenOptions | number = {}): void {
    const opts: SellerListenOptions = typeof options === 'number' ? { port: options } : options;
    const port = opts.port || 3001;
    const markupPercent = opts.markupPercent ?? 15;
    const autoAcceptCounters = opts.autoAcceptCounters ?? true;

    const sessionManager = new SessionManager();
    const priceMap = new Map<string, number>();

    const server = createBCPServer(sessionManager, {
      port,
      disableTimestampCheck: true,
      disableReplayProtection: true,
    });

    const onMessage = (server as unknown as Record<string, (type: string, handler: MessageHandler) => void>).onMessage;

    // ── INTENT → QUOTE ──────────────────────────────────────────────
    onMessage('intent', async (msg: BCPMessage): Promise<BCPMessage | null> => {
      const intent = msg as IntentMessage;

      let price: number;
      if (opts.pricing) {
        const result = opts.pricing(intent);
        price = result.price;
      } else {
        const budgetHint = intent.budget || 100;
        price = Math.round(budgetHint * (1 + markupPercent / 100) * 100) / 100;
      }

      priceMap.set(intent.sessionId, price);
      log.info('← INTENT, sending QUOTE', { service: intent.service, price });

      const quote: QuoteMessage = {
        bcp_version: '0.3',
        type: 'quote',
        sessionId: intent.sessionId,
        timestamp: new Date().toISOString(),
        price,
        currency: intent.currency || 'USDC',
        deliverables: [intent.service],
        settlement: 'escrow',
      };

      const sig = signMessage(quote as unknown as Record<string, unknown>, this.ed25519.privateKey);
      return { ...quote, signature: sig } as unknown as BCPMessage;
    });

    // ── COUNTER → Revised QUOTE ─────────────────────────────────────
    onMessage('counter', async (msg: BCPMessage): Promise<BCPMessage | null> => {
      const counter = msg as CounterMessage;

      if (!autoAcceptCounters) {
        log.info('← COUNTER (not auto-accepting)', { counterPrice: counter.counterPrice });
        return null;
      }

      log.info('← COUNTER, accepting', { proposed: counter.counterPrice });
      priceMap.set(counter.sessionId, counter.counterPrice);

      const quote: QuoteMessage = {
        bcp_version: '0.3',
        type: 'quote',
        sessionId: counter.sessionId,
        timestamp: new Date().toISOString(),
        price: counter.counterPrice,
        currency: 'USDC',
        settlement: 'escrow',
      };

      const sig = signMessage(quote as unknown as Record<string, unknown>, this.ed25519.privateKey);
      return { ...quote, signature: sig } as unknown as BCPMessage;
    });

    // ── COMMIT → FULFIL ─────────────────────────────────────────────
    onMessage('commit', async (msg: BCPMessage): Promise<BCPMessage | null> => {
      const commit = msg as CommitMessage;
      log.info('← COMMIT, releasing escrow', { sessionId: commit.sessionId, amount: commit.agreedPrice });

      const buyerAddr = process.env.BUYER_EVM_ADDRESS || '';
      const escrow = OnChainEscrowProvider.createSellerInstance({
        rpcUrl: this.networkConfig.rpcUrl,
        contractAddress: this.contractAddress,
        sellerPrivateKey: this.evmKey,
        buyerAddress: buyerAddr,
        tokenAddress: this.tokenAddress,
        tokenDecimals: this.tokenDecimals,
      });

      const fulfil: FulfilMessage = {
        bcp_version: '0.3',
        type: 'fulfil',
        sessionId: commit.sessionId,
        timestamp: new Date().toISOString(),
        summary: 'Service delivered',
        deliverables: ['Completed'],
      };

      try {
        const releaseReceipt = await escrow.release(fulfil);
        log.info('✓ ESCROW RELEASED', { tx: releaseReceipt.tx_hash });
        fulfil.proofHash = releaseReceipt.tx_hash;

        opts.onDealComplete?.({
          sessionId: commit.sessionId,
          price: commit.agreedPrice,
          currency: commit.currency,
          releaseTxHash: releaseReceipt.tx_hash,
        });
      } catch (err) {
        log.warn('Escrow release failed (may be test mode)', { error: (err as Error).message });
      }

      const sig = signMessage(fulfil as unknown as Record<string, unknown>, this.ed25519.privateKey);
      return { ...fulfil, signature: sig } as unknown as BCPMessage;
    });

    // ── DISPUTE handler ─────────────────────────────────────────────
    onMessage('dispute', async (msg: BCPMessage): Promise<BCPMessage | null> => {
      const dispute = msg as DisputeMessage;
      log.info('← DISPUTE', { sessionId: dispute.sessionId, reason: dispute.reason });
      opts.onDisputeReceived?.(dispute);
      return null;
    });

    server.listen(port, () => {
      log.info(`BCP Seller listening on port ${port}`);
    });
  }
}
