/**
 * BCP session state machine — tracks conversation state and enforces valid transitions.
 * @module state/session
 */

import { IntentMessage } from '../messages/intent';
import { QuoteMessage } from '../messages/quote';
import { CounterMessage } from '../messages/counter';
import { CommitMessage } from '../messages/commit';
import { FulfilMessage } from '../messages/fulfil';
import { DisputeMessage } from '../messages/dispute';

/** All BCP message types (union) */
export type BCPMessage =
  | IntentMessage
  | QuoteMessage
  | CounterMessage
  | CommitMessage
  | FulfilMessage
  | DisputeMessage;

/** Session states */
export type SessionState =
  | 'INITIATED'
  | 'QUOTED'
  | 'COUNTERED'
  | 'COMMITTED'
  | 'FULFILLED'
  | 'DISPUTED';

/** BCP error codes */
export enum BCPErrorCode {
  INVALID_SIGNATURE = 'BCP_001',
  EXPIRED_MESSAGE = 'BCP_002',
  INVALID_STATE_TRANSITION = 'BCP_003',
  INSUFFICIENT_ESCROW = 'BCP_004',
  UNKNOWN_REF_ID = 'BCP_005',
}

/** BCP protocol error */
export class BCPError extends Error {
  constructor(
    public readonly code: BCPErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'BCPError';
  }
}

/** Valid state transitions: from state -> allowed message types -> resulting state */
const TRANSITIONS: Record<SessionState, Partial<Record<string, SessionState>>> = {
  INITIATED: { QUOTE: 'QUOTED' },
  QUOTED: { COUNTER: 'COUNTERED', COMMIT: 'COMMITTED' },
  COUNTERED: { COUNTER: 'COUNTERED', COMMIT: 'COMMITTED', QUOTE: 'QUOTED' },
  COMMITTED: { FULFIL: 'FULFILLED', DISPUTE: 'DISPUTED' },
  FULFILLED: {},
  DISPUTED: { UNFROZEN: 'COMMITTED' },
};

/** A single BCP session keyed by intent_id */
export interface Session {
  /** The intent_id that this session tracks */
  intentId: string;
  /** Current state of the session */
  state: SessionState;
  /** All messages in this session, in order */
  messages: BCPMessage[];
  /** The most recent quote or counter ref_id (for validating COMMIT) */
  lastOfferId: string | null;
  /** The commit_id (for validating FULFIL/DISPUTE) */
  commitId: string | null;
  /** Created timestamp */
  createdAt: string;
  /** Last updated timestamp */
  updatedAt: string;
}

// ── SessionStore interface ──────────────────────────────────────────

/**
 * Pluggable session storage backend.
 *
 * The default implementation (InMemorySessionStore) stores sessions in a Map.
 * For production, implement this interface with Redis, Postgres, etc.
 *
 * Example Redis implementation:
 *   class RedisSessionStore implements SessionStore {
 *     async get(intentId: string) { return JSON.parse(await redis.get(`bcp:${intentId}`)); }
 *     async save(session: Session) { await redis.set(`bcp:${session.intentId}`, JSON.stringify(session)); }
 *     async all() { /* scan bcp:* * / }
 *     async findByLastOfferId(offerId: string) { /* secondary index * / }
 *     async findByCommitId(commitId: string) { /* secondary index * / }
 *   }
 */
export interface SessionStore {
  /** Get a session by intent_id */
  get(intentId: string): Session | undefined;
  /** Save (create or update) a session */
  save(session: Session): void;
  /** Get all sessions */
  all(): Session[];
  /** Find a session where lastOfferId matches */
  findByLastOfferId(offerId: string): Session | undefined;
  /** Find a session where commitId matches */
  findByCommitId(commitId: string): Session | undefined;
}

/**
 * Default in-memory session store. Sessions are lost on restart.
 */
export class InMemorySessionStore implements SessionStore {
  private sessions: Map<string, Session> = new Map();

  get(intentId: string): Session | undefined {
    return this.sessions.get(intentId);
  }

  save(session: Session): void {
    this.sessions.set(session.intentId, session);
  }

  all(): Session[] {
    return Array.from(this.sessions.values());
  }

  findByLastOfferId(offerId: string): Session | undefined {
    for (const session of this.sessions.values()) {
      if (session.lastOfferId === offerId) return session;
    }
    return undefined;
  }

  findByCommitId(commitId: string): Session | undefined {
    for (const session of this.sessions.values()) {
      if (session.commitId === commitId) return session;
    }
    return undefined;
  }
}

// ── SessionManager ─────────────────────────────────────────────────

/**
 * Session state machine — tracks BCP sessions and enforces valid transitions.
 * Accepts an optional SessionStore for pluggable persistence.
 */
export class SessionManager {
  private store: SessionStore;

  constructor(store?: SessionStore) {
    this.store = store || new InMemorySessionStore();
  }

  /**
   * Process an incoming BCP message and advance the state machine.
   * @param message - The validated BCP message
   * @returns The updated session
   * @throws BCPError on invalid state transition or unknown reference
   */
  processMessage(message: BCPMessage): Session {
    switch (message.message_type) {
      case 'INTENT':
        return this.handleIntent(message);
      case 'QUOTE':
        return this.handleQuote(message);
      case 'COUNTER':
        return this.handleCounter(message);
      case 'COMMIT':
        return this.handleCommit(message);
      case 'FULFIL':
        return this.handleFulfil(message);
      case 'DISPUTE':
        return this.handleDispute(message);
      default:
        throw new BCPError(
          BCPErrorCode.INVALID_STATE_TRANSITION,
          `Unknown message type: ${(message as Record<string, unknown>).message_type}`
        );
    }
  }

  /**
   * Get a session by intent_id.
   * @param intentId - The intent_id to look up
   * @returns The session if it exists, undefined otherwise
   */
  getSession(intentId: string): Session | undefined {
    return this.store.get(intentId);
  }

  /**
   * Get all active sessions.
   * @returns Array of all sessions
   */
  getAllSessions(): Session[] {
    return this.store.all();
  }

  /**
   * Transition a DISPUTED session back to COMMITTED after both parties approve unfreeze.
   * This is not triggered by a BCP message — it's an escrow-level event.
   * @param commitId - The commit_id of the disputed session
   * @returns The updated session
   * @throws BCPError if session not found or not in DISPUTED state
   */
  markUnfrozen(commitId: string): Session {
    const session = this.store.findByCommitId(commitId);
    if (!session) {
      throw new BCPError(
        BCPErrorCode.UNKNOWN_REF_ID,
        `No session found for commit_id: ${commitId}`
      );
    }
    this.assertTransition(session, 'UNFROZEN');
    session.state = 'COMMITTED';
    session.updatedAt = new Date().toISOString();
    return session;
  }

  private handleIntent(message: IntentMessage): Session {
    const session: Session = {
      intentId: message.intent_id,
      state: 'INITIATED',
      messages: [message],
      lastOfferId: null,
      commitId: null,
      createdAt: message.timestamp,
      updatedAt: message.timestamp,
    };
    this.store.save(session);
    return session;
  }

  private handleQuote(message: QuoteMessage): Session {
    const session = this.store.get(message.intent_id);
    if (!session) {
      throw new BCPError(
        BCPErrorCode.UNKNOWN_REF_ID,
        `No session found for intent_id: ${message.intent_id}`
      );
    }
    this.assertTransition(session, 'QUOTE');
    session.state = 'QUOTED';
    session.lastOfferId = message.quote_id;
    session.messages.push(message);
    session.updatedAt = message.timestamp;
    return session;
  }

  private handleCounter(message: CounterMessage): Session {
    const session = this.store.findByLastOfferId(message.ref_id);
    if (!session) {
      throw new BCPError(
        BCPErrorCode.UNKNOWN_REF_ID,
        `No session found for ref_id: ${message.ref_id}`
      );
    }
    this.assertTransition(session, 'COUNTER');
    session.state = 'COUNTERED';
    session.lastOfferId = message.counter_id;
    session.messages.push(message);
    session.updatedAt = message.timestamp;
    return session;
  }

  private handleCommit(message: CommitMessage): Session {
    const session = this.store.findByLastOfferId(message.accepted_ref_id);
    if (!session) {
      throw new BCPError(
        BCPErrorCode.UNKNOWN_REF_ID,
        `No session found for accepted_ref_id: ${message.accepted_ref_id}`
      );
    }
    this.assertTransition(session, 'COMMIT');

    // ── Expiry enforcement ─────────────────────────────────────────
    // Find the offer being accepted and reject if it has expired.
    const refMsg = session.messages.find((m) => {
      if (m.message_type === 'QUOTE' && (m as QuoteMessage).quote_id === message.accepted_ref_id) return true;
      if (m.message_type === 'COUNTER' && (m as CounterMessage).counter_id === message.accepted_ref_id) return true;
      return false;
    });
    if (refMsg) {
      const expiresAt = refMsg.message_type === 'QUOTE'
        ? (refMsg as QuoteMessage).offer.validity_until
        : (refMsg as CounterMessage).new_validity_until;
      if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
        throw new BCPError(
          BCPErrorCode.EXPIRED_MESSAGE,
          `Offer ${message.accepted_ref_id} expired at ${expiresAt}`,
          { accepted_ref_id: message.accepted_ref_id, expired_at: expiresAt }
        );
      }
    }

    session.state = 'COMMITTED';
    session.commitId = message.commit_id;
    session.messages.push(message);
    session.updatedAt = message.timestamp;
    return session;
  }

  private handleFulfil(message: FulfilMessage): Session {
    const session = this.store.findByCommitId(message.commit_id);
    if (!session) {
      throw new BCPError(
        BCPErrorCode.UNKNOWN_REF_ID,
        `No session found for commit_id: ${message.commit_id}`
      );
    }
    this.assertTransition(session, 'FULFIL');
    session.state = 'FULFILLED';
    session.messages.push(message);
    session.updatedAt = message.timestamp;
    return session;
  }

  private handleDispute(message: DisputeMessage): Session {
    const session = this.store.findByCommitId(message.commit_id);
    if (!session) {
      throw new BCPError(
        BCPErrorCode.UNKNOWN_REF_ID,
        `No session found for commit_id: ${message.commit_id}`
      );
    }
    this.assertTransition(session, 'DISPUTE');
    session.state = 'DISPUTED';
    session.messages.push(message);
    session.updatedAt = message.timestamp;
    return session;
  }

  /**
   * Assert that a message type is a valid transition from the current state.
   * @throws BCPError with BCP_003 if transition is invalid
   */
  private assertTransition(session: Session, messageType: string): void {
    const allowed = TRANSITIONS[session.state];
    if (!allowed[messageType]) {
      throw new BCPError(
        BCPErrorCode.INVALID_STATE_TRANSITION,
        `Cannot send ${messageType} in state ${session.state}`,
        { current_state: session.state, attempted_transition: messageType }
      );
    }
  }
}
