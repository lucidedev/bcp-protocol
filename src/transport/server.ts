/**
 * BCP transport server — Express server exposing BCP endpoints.
 *
 * Security enforcements (per SPEC §8):
 * - Mandatory Ed25519 signature verification on all inbound messages
 * - Timestamp freshness check (reject messages older than maxAgeSec, default 300s)
 * - Replay protection via message-ID deduplication
 * - Spending-limit enforcement on COMMIT messages
 *
 * @module transport/server
 */

import express, { Request, Response, NextFunction } from 'express';
import { SessionManager, BCPError, BCPErrorCode, BCPMessage } from '../state/session';
import { validateMessage } from '../validation/validator';
import { verifyMessage } from '../validation/signature';

/** Server configuration */
export interface BCPServerConfig {
  /** Port to listen on */
  port?: number;
  /** Public key resolver — maps wallet addresses to public keys.
   *  REQUIRED for production. If omitted, server rejects all messages
   *  that carry a wallet address (fail-closed). */
  resolvePublicKey?: (walletAddress: string) => string | undefined;
  /** Maximum message age in seconds (default 300 = 5 min, per SPEC §8) */
  maxAgeSec?: number;
  /** Disable timestamp validation (for testing only) */
  disableTimestampCheck?: boolean;
  /** Disable replay protection (for testing only) */
  disableReplayProtection?: boolean;
}

/** Event handler for incoming BCP messages */
export type MessageHandler = (message: BCPMessage) => Promise<BCPMessage | null>;

/**
 * Create and configure a BCP protocol server.
 * @param sessionManager - The session manager for state tracking
 * @param config - Server configuration
 * @returns Configured Express application
 */
export function createBCPServer(
  sessionManager: SessionManager,
  config: BCPServerConfig = {}
): express.Application {
  const app = express();
  app.use(express.json());

  const maxAgeSec = config.maxAgeSec ?? 300;

  /** Seen message IDs for replay protection (ID → timestamp) */
  const seenMessages: Map<string, number> = new Map();
  /** Prune seen messages older than 2× maxAge every 60s */
  const PRUNE_INTERVAL = 60_000;
  const pruneThreshold = maxAgeSec * 2 * 1000;
  let lastPrune = Date.now();

  function pruneSeenMessages(): void {
    const now = Date.now();
    if (now - lastPrune < PRUNE_INTERVAL) return;
    lastPrune = now;
    for (const [id, ts] of seenMessages) {
      if (now - ts > pruneThreshold) seenMessages.delete(id);
    }
  }

  /** Message handler registry */
  const handlers: Map<string, MessageHandler> = new Map();

  /**
   * Register a handler for a message type. The handler receives the
   * validated message and returns an optional response message.
   */
  (app as unknown as Record<string, unknown>)['onMessage'] =
    (type: string, handler: MessageHandler) => {
      handlers.set(type, handler);
    };

  /** Generic BCP message endpoint handler */
  async function handleBCPMessage(req: Request, res: Response, _next: NextFunction): Promise<void> {
    const message = req.body as Record<string, unknown>;

    // ── Step 1: Validate against JSON schema ────────────────────────
    const validation = validateMessage(message);
    if (!validation.valid) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Message failed schema validation',
          details: validation.errors,
        },
      });
      return;
    }

    // ── Step 2: Timestamp / TTL freshness check ─────────────────────
    if (!config.disableTimestampCheck) {
      const timestamp = message.timestamp as string | undefined;
      if (!timestamp) {
        res.status(400).json({
          error: { code: BCPErrorCode.EXPIRED_MESSAGE, message: 'Missing timestamp' },
        });
        return;
      }
      const msgTime = new Date(timestamp).getTime();
      if (isNaN(msgTime)) {
        res.status(400).json({
          error: { code: BCPErrorCode.EXPIRED_MESSAGE, message: 'Invalid timestamp' },
        });
        return;
      }
      const ageSec = (Date.now() - msgTime) / 1000;
      if (ageSec > maxAgeSec || ageSec < -maxAgeSec) {
        res.status(400).json({
          error: {
            code: BCPErrorCode.EXPIRED_MESSAGE,
            message: `Message timestamp outside acceptable window (${maxAgeSec}s)`,
            details: { timestamp, age_seconds: Math.round(ageSec) },
          },
        });
        return;
      }
    }

    // ── Step 3: Replay protection ───────────────────────────────────
    if (!config.disableReplayProtection) {
      const msgId = extractMessageId(message);
      if (msgId !== 'unknown') {
        pruneSeenMessages();
        if (seenMessages.has(msgId)) {
          res.status(409).json({
            error: {
              code: 'REPLAY_DETECTED',
              message: `Message ${msgId} has already been processed`,
            },
          });
          return;
        }
        seenMessages.set(msgId, Date.now());
      }
    }

    // ── Step 4: Mandatory signature verification ────────────────────
    const walletAddress = extractWalletAddress(message);
    if (walletAddress) {
      if (!config.resolvePublicKey) {
        // Fail-closed: no resolver means we can't verify → reject
        res.status(403).json({
          error: {
            code: BCPErrorCode.INVALID_SIGNATURE,
            message: 'No public key resolver configured — cannot verify signature',
          },
        });
        return;
      }
      const publicKey = config.resolvePublicKey(walletAddress);
      if (!publicKey) {
        res.status(403).json({
          error: {
            code: BCPErrorCode.INVALID_SIGNATURE,
            message: `Unknown wallet address: ${walletAddress}`,
          },
        });
        return;
      }
      if (!verifyMessage(message, publicKey)) {
        res.status(403).json({
          error: {
            code: BCPErrorCode.INVALID_SIGNATURE,
            message: 'Ed25519 signature verification failed',
          },
        });
        return;
      }
    }

    // ── Step 5: Spending limit enforcement on COMMIT ────────────────
    if (message.message_type === 'COMMIT') {
      const escrow = message.escrow as Record<string, unknown> | undefined;
      const escrowAmount = escrow?.amount as number | undefined;
      if (escrowAmount !== undefined) {
        // Find the original INTENT's spending_limit via the session
        const acceptedRefId = message.accepted_ref_id as string;
        const session = findSessionByRefId(sessionManager, acceptedRefId);
        if (session) {
          const intentMsg = session.messages[0] as unknown as Record<string, unknown>;
          const buyer = intentMsg?.buyer as Record<string, unknown> | undefined;
          const spendingLimit = buyer?.spending_limit as number | undefined;
          if (spendingLimit !== undefined && escrowAmount > spendingLimit) {
            res.status(400).json({
              error: {
                code: BCPErrorCode.INSUFFICIENT_ESCROW,
                message: `Escrow amount (${escrowAmount}) exceeds buyer spending limit (${spendingLimit})`,
                details: { escrow_amount: escrowAmount, spending_limit: spendingLimit },
              },
            });
            return;
          }
        }
      }
    }

    // ── Step 6: Process through state machine ───────────────────────
    try {
      const session = sessionManager.processMessage(message as unknown as BCPMessage);

      // Step 7: Call registered handler
      const messageType = message.message_type as string;
      const handler = handlers.get(messageType);
      let responseMessage: BCPMessage | null = null;
      if (handler) {
        responseMessage = await handler(message as unknown as BCPMessage);
      }

      const responseBody: Record<string, unknown> = {
        accepted: true,
        message_id: extractMessageId(message),
        session_state: session.state,
      };
      if (responseMessage) {
        responseBody.response = responseMessage;
      }

      res.status(200).json(responseBody);
    } catch (err) {
      if (err instanceof BCPError) {
        const statusCode = err.code === BCPErrorCode.UNKNOWN_REF_ID ? 400
          : err.code === BCPErrorCode.INVALID_STATE_TRANSITION ? 409
          : 400;
        res.status(statusCode).json({
          error: {
            code: err.code,
            message: err.message,
            details: err.details,
          },
        });
        return;
      }
      throw err;
    }
  }

  // Mount endpoints for each message type
  app.post('/bcp/intent', handleBCPMessage);
  app.post('/bcp/quote', handleBCPMessage);
  app.post('/bcp/counter', handleBCPMessage);
  app.post('/bcp/commit', handleBCPMessage);
  app.post('/bcp/fulfil', handleBCPMessage);
  app.post('/bcp/dispute', handleBCPMessage);

  return app;
}

/**
 * Extract the wallet address from a BCP message for signature verification.
 * @param message - The raw message object
 * @returns Wallet address string or undefined
 */
function extractWalletAddress(message: Record<string, unknown>): string | undefined {
  const buyer = message.buyer as Record<string, unknown> | undefined;
  if (buyer?.agent_wallet_address) {
    return buyer.agent_wallet_address as string;
  }
  const seller = message.seller as Record<string, unknown> | undefined;
  if (seller?.agent_wallet_address) {
    return seller.agent_wallet_address as string;
  }
  return undefined;
}

/**
 * Extract the primary message ID from a BCP message.
 * @param message - The raw message object
 * @returns The message ID
 */
function extractMessageId(message: Record<string, unknown>): string {
  return (
    (message.intent_id as string) ||
    (message.quote_id as string) ||
    (message.counter_id as string) ||
    (message.commit_id as string) ||
    (message.fulfil_id as string) ||
    (message.dispute_id as string) ||
    'unknown'
  );
}

/**
 * Find a session by a quote_id or counter_id reference.
 */
function findSessionByRefId(
  sessionManager: SessionManager,
  refId: string
): { messages: BCPMessage[] } | undefined {
  for (const session of sessionManager.getAllSessions()) {
    if (session.lastOfferId === refId) return session;
  }
  return undefined;
}
