/**
 * BCP session state machine — tracks conversation state and enforces valid transitions.
 *
 * 7 states matching 7 message types:
 *   initiated → quoted → [countered →] committed → fulfilled → [accepted] | disputed
 *
 * @module state/session
 */

import type { BCPMessage } from '../messages/types';

// ── States ─────────────────────────────────────────────────────────

export type SessionState =
  | 'initiated'
  | 'quoted'
  | 'countered'
  | 'committed'
  | 'fulfilled'
  | 'accepted'
  | 'disputed';

// ── Errors ─────────────────────────────────────────────────────────

export enum BCPErrorCode {
  INVALID_TRANSITION = 'BCP_001',
  UNKNOWN_SESSION    = 'BCP_002',
  EXPIRED            = 'BCP_003',
  BAD_SIGNATURE      = 'BCP_004',
  VALIDATION         = 'BCP_005',
}

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

// ── Transition table ───────────────────────────────────────────────

const TRANSITIONS: Record<SessionState, Partial<Record<BCPMessage['type'], SessionState>>> = {
  initiated:  { quote: 'quoted' },
  quoted:     { counter: 'countered', commit: 'committed' },
  countered:  { counter: 'countered', commit: 'committed', quote: 'quoted' },
  committed:  { fulfil: 'fulfilled', dispute: 'disputed' },
  fulfilled:  { accept: 'accepted', dispute: 'disputed' },
  accepted:   {},
  disputed:   {},
};

// ── Session record ─────────────────────────────────────────────────

export interface Session {
  /** Session identifier (set by buyer in INTENT) */
  sessionId: string;
  /** Current state */
  state: SessionState;
  /** Ordered message trail */
  messages: BCPMessage[];
  /** DID of the buyer (if provided) */
  buyerDid?: string;
  /** DID of the seller (if provided) */
  sellerDid?: string;
  /** Async callback URL */
  callbackUrl?: string;
  /** Created timestamp */
  createdAt: string;
  /** Last updated timestamp */
  updatedAt: string;
}

// ── Store interface ────────────────────────────────────────────────

export interface SessionStore {
  get(sessionId: string): Session | undefined;
  save(session: Session): void;
  all(): Session[];
}

export class InMemorySessionStore implements SessionStore {
  private sessions: Map<string, Session> = new Map();
  get(sessionId: string): Session | undefined { return this.sessions.get(sessionId); }
  save(session: Session): void { this.sessions.set(session.sessionId, session); }
  all(): Session[] { return Array.from(this.sessions.values()); }
}

// ── Session manager ────────────────────────────────────────────────

export class SessionManager {
  private store: SessionStore;

  constructor(store?: SessionStore) {
    this.store = store || new InMemorySessionStore();
  }

  processMessage(msg: BCPMessage): Session {
    if (msg.type === 'intent') {
      const session: Session = {
        sessionId: msg.sessionId,
        state: 'initiated',
        messages: [msg],
        buyerDid: msg.did,
        callbackUrl: msg.callbackUrl,
        createdAt: msg.timestamp,
        updatedAt: msg.timestamp,
      };
      this.store.save(session);
      return session;
    }

    const session = this.store.get(msg.sessionId);
    if (!session) {
      throw new BCPError(
        BCPErrorCode.UNKNOWN_SESSION,
        `No session found for sessionId: ${msg.sessionId}`
      );
    }

    const next = TRANSITIONS[session.state][msg.type];
    if (!next) {
      throw new BCPError(
        BCPErrorCode.INVALID_TRANSITION,
        `Cannot process ${msg.type} in state ${session.state}`,
        { state: session.state, type: msg.type }
      );
    }

    // Track DIDs
    if (msg.did && !session.sellerDid && msg.type === 'quote') {
      session.sellerDid = msg.did;
    }

    session.state = next;
    session.messages.push(msg);
    session.updatedAt = msg.timestamp;
    this.store.save(session);
    return session;
  }

  getSession(sessionId: string): Session | undefined {
    return this.store.get(sessionId);
  }

  getAllSessions(): Session[] {
    return this.store.all();
  }
}
