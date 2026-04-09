/**
 * BCP transport server — Express server with unified POST /bcp endpoint.
 *
 * Security enforcements:
 * - Optional Ed25519 signature verification on inbound messages
 * - Timestamp freshness check (configurable)
 * - Replay protection via sessionId+type deduplication
 *
 * @module transport/server
 */

import express, { Request, Response, NextFunction } from 'express';
import { SessionManager, BCPError, BCPErrorCode } from '../state/session';
import type { BCPMessage } from '../messages/types';
import { validateMessage } from '../validation/validator';
import { verifyMessage } from '../validation/signature';
import { deliverCallback, wantsCallback } from './callback';

/** Server configuration */
export interface BCPServerConfig {
  port?: number;
  resolvePublicKey?: (did: string) => string | undefined;
  maxAgeSec?: number;
  disableTimestampCheck?: boolean;
  disableReplayProtection?: boolean;
}

/** Event handler for incoming BCP messages */
export type MessageHandler = (message: BCPMessage) => Promise<BCPMessage | null>;

/**
 * Create and configure a BCP protocol server.
 */
export function createBCPServer(
  sessionManager: SessionManager,
  config: BCPServerConfig = {}
): express.Application {
  const app = express();
  app.use(express.json());

  const maxAgeSec = config.maxAgeSec ?? 300;
  const seenMessages = new Set<string>();
  const handlers = new Map<string, MessageHandler>();

  (app as unknown as Record<string, unknown>)['onMessage'] =
    (type: string, handler: MessageHandler) => {
      handlers.set(type, handler);
    };

  /** Unified BCP endpoint */
  app.post('/bcp', async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const message = req.body as Record<string, unknown>;

    // ── Validate ────────────────────────────────────────────────────
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

    // ── Timestamp check ─────────────────────────────────────────────
    if (!config.disableTimestampCheck) {
      const timestamp = message.timestamp as string | undefined;
      if (!timestamp) {
        res.status(400).json({ error: { code: BCPErrorCode.EXPIRED, message: 'Missing timestamp' } });
        return;
      }
      const ageSec = (Date.now() - new Date(timestamp).getTime()) / 1000;
      if (isNaN(ageSec) || Math.abs(ageSec) > maxAgeSec) {
        res.status(400).json({
          error: {
            code: BCPErrorCode.EXPIRED,
            message: `Message timestamp outside acceptable window (${maxAgeSec}s)`,
          },
        });
        return;
      }
    }

    // ── Replay protection ───────────────────────────────────────────
    if (!config.disableReplayProtection) {
      const dedupeKey = `${message.sessionId}:${message.type}:${message.timestamp}`;
      if (seenMessages.has(dedupeKey)) {
        res.status(409).json({ error: { code: 'REPLAY', message: 'Duplicate message' } });
        return;
      }
      seenMessages.add(dedupeKey);
    }

    // ── Signature verification (optional) ───────────────────────────
    if (message.signature && config.resolvePublicKey) {
      const did = message.did as string;
      const pubKey = did ? config.resolvePublicKey(did) : undefined;
      if (pubKey) {
        const { signature, ...payload } = message;
        const isValid = verifyMessage(payload, pubKey);
        if (!isValid) {
          res.status(401).json({ error: { code: BCPErrorCode.BAD_SIGNATURE, message: 'Invalid signature' } });
          return;
        }
      }
    }

    // ── State machine ───────────────────────────────────────────────
    try {
      const typedMsg = message as unknown as BCPMessage;
      const session = sessionManager.processMessage(typedMsg);

      // Check for custom handler
      const handler = handlers.get(typedMsg.type);
      if (handler) {
        const response = await handler(typedMsg);
        if (response) {
          // If callbackUrl, deliver async
          if (wantsCallback(typedMsg)) {
            deliverCallback(typedMsg.callbackUrl!, response as BCPMessage);
            res.status(202).json({
              accepted: true,
              sessionId: session.sessionId,
              session_state: session.state,
            });
            return;
          }

          // Process response through state machine too
          const updatedSession = sessionManager.processMessage(response);
          res.json({
            accepted: true,
            sessionId: session.sessionId,
            session_state: updatedSession.state,
            response,
          });
          return;
        }
      }

      res.json({
        accepted: true,
        sessionId: session.sessionId,
        session_state: session.state,
      });
    } catch (err) {
      if (err instanceof BCPError) {
        res.status(400).json({ error: { code: err.code, message: err.message, details: err.details } });
      } else {
        res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error' } });
      }
    }
  });

  return app;
}
