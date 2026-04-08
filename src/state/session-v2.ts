/**
 * BCP v0.2 Session State Machine
 *
 * Same state transitions as v0.1 but works with lean v0.2 messages.
 * No mandatory escrow, no mandatory signatures.
 *
 * @module state/session-v2
 */

import type {
  BCPMessageV2,
  IntentMessageV2,
  QuoteMessageV2,
  CounterMessageV2,
  CommitMessageV2,
  FulfilMessageV2,
  DisputeMessageV2,
  AuthMode,
  Settlement,
} from '../messages/v2';

// ── Types ──────────────────────────────────────────────────────────

/** Session states (lowercase in v0.2) */
export type SessionStateV2 =
  | 'initiated'
  | 'quoted'
  | 'countered'
  | 'committed'
  | 'fulfilled'
  | 'disputed';

/** BCP error codes */
export enum BCPErrorCodeV2 {
  INVALID_SIGNATURE = 'BCP_001',
  EXPIRED = 'BCP_002',
  INVALID_STATE = 'BCP_003',
  PRICE_MISMATCH = 'BCP_004',
  UNKNOWN_SESSION = 'BCP_005',
}

/** BCP protocol error */
export class BCPErrorV2 extends Error {
  constructor(
    public readonly code: BCPErrorCodeV2,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'BCPError';
  }
}

/** Valid transitions: state → allowed message types → next state */
const TRANSITIONS: Record<SessionStateV2, Partial<Record<string, SessionStateV2>>> = {
  initiated: { quote: 'quoted' },
  quoted:    { counter: 'countered', commit: 'committed' },
  countered: { counter: 'countered', commit: 'committed', quote: 'quoted' },
  committed: { fulfil: 'fulfilled', dispute: 'disputed' },
  fulfilled: {},
  disputed:  {},
};

/** A BCP v0.2 session */
export interface SessionV2 {
  /** Session ID (from buyer's INTENT) */
  sessionId: string;
  /** Current state */
  state: SessionStateV2;
  /** All messages in order */
  messages: BCPMessageV2[];
  /** Last quoted/countered price */
  lastPrice: number | null;
  /** Agreed settlement method */
  settlement: Settlement | null;
  /** Auth mode for this session */
  auth: AuthMode;
  /** Created timestamp */
  createdAt: string;
  /** Last updated timestamp */
  updatedAt: string;
}

// ── Store ──────────────────────────────────────────────────────────

/** Pluggable session storage */
export interface SessionStoreV2 {
  get(sessionId: string): SessionV2 | undefined;
  save(session: SessionV2): void;
  all(): SessionV2[];
}

/** Default in-memory store */
export class InMemorySessionStoreV2 implements SessionStoreV2 {
  private sessions = new Map<string, SessionV2>();

  get(sessionId: string): SessionV2 | undefined {
    return this.sessions.get(sessionId);
  }

  save(session: SessionV2): void {
    this.sessions.set(session.sessionId, session);
  }

  all(): SessionV2[] {
    return Array.from(this.sessions.values());
  }
}

// ── Session Manager ────────────────────────────────────────────────

export class SessionManagerV2 {
  private store: SessionStoreV2;

  constructor(store?: SessionStoreV2) {
    this.store = store || new InMemorySessionStoreV2();
  }

  /** Process a BCP v0.2 message and advance state */
  processMessage(msg: BCPMessageV2): SessionV2 {
    switch (msg.type) {
      case 'intent':  return this.handleIntent(msg);
      case 'quote':   return this.handleQuote(msg);
      case 'counter': return this.handleCounter(msg);
      case 'commit':  return this.handleCommit(msg);
      case 'fulfil':  return this.handleFulfil(msg);
      case 'dispute': return this.handleDispute(msg);
      default:
        throw new BCPErrorV2(
          BCPErrorCodeV2.INVALID_STATE,
          `Unknown message type: ${(msg as Record<string, unknown>).type}`
        );
    }
  }

  getSession(sessionId: string): SessionV2 | undefined {
    return this.store.get(sessionId);
  }

  getAllSessions(): SessionV2[] {
    return this.store.all();
  }

  // ── Handlers ───────────────────────────────────────────────────

  private handleIntent(msg: IntentMessageV2): SessionV2 {
    const session: SessionV2 = {
      sessionId: msg.sessionId,
      state: 'initiated',
      messages: [msg],
      lastPrice: null,
      settlement: null,
      auth: msg.auth ?? 'none',
      createdAt: msg.timestamp,
      updatedAt: msg.timestamp,
    };
    this.store.save(session);
    return session;
  }

  private handleQuote(msg: QuoteMessageV2): SessionV2 {
    const session = this.getOrThrow(msg.sessionId);
    this.assertTransition(session, msg.type);
    session.state = 'quoted';
    session.lastPrice = msg.price;
    if (msg.settlement) session.settlement = msg.settlement;
    session.messages.push(msg);
    session.updatedAt = msg.timestamp;
    this.store.save(session);
    return session;
  }

  private handleCounter(msg: CounterMessageV2): SessionV2 {
    const session = this.getOrThrow(msg.sessionId);
    this.assertTransition(session, msg.type);
    session.state = 'countered';
    session.lastPrice = msg.counterPrice;
    session.messages.push(msg);
    session.updatedAt = msg.timestamp;
    this.store.save(session);
    return session;
  }

  private handleCommit(msg: CommitMessageV2): SessionV2 {
    const session = this.getOrThrow(msg.sessionId);
    this.assertTransition(session, msg.type);

    // Check quote expiry if the last QUOTE had validUntil
    const lastQuote = [...session.messages]
      .reverse()
      .find((m): m is QuoteMessageV2 => m.type === 'quote');
    if (lastQuote?.validUntil && new Date(lastQuote.validUntil).getTime() < Date.now()) {
      throw new BCPErrorV2(
        BCPErrorCodeV2.EXPIRED,
        `Quote expired at ${lastQuote.validUntil}`,
        { validUntil: lastQuote.validUntil }
      );
    }

    if (msg.settlement) session.settlement = msg.settlement;
    session.state = 'committed';
    session.messages.push(msg);
    session.updatedAt = msg.timestamp;
    this.store.save(session);
    return session;
  }

  private handleFulfil(msg: FulfilMessageV2): SessionV2 {
    const session = this.getOrThrow(msg.sessionId);
    this.assertTransition(session, msg.type);
    session.state = 'fulfilled';
    session.messages.push(msg);
    session.updatedAt = msg.timestamp;
    this.store.save(session);
    return session;
  }

  private handleDispute(msg: DisputeMessageV2): SessionV2 {
    const session = this.getOrThrow(msg.sessionId);
    this.assertTransition(session, msg.type);
    session.state = 'disputed';
    session.messages.push(msg);
    session.updatedAt = msg.timestamp;
    this.store.save(session);
    return session;
  }

  // ── Helpers ────────────────────────────────────────────────────

  private getOrThrow(sessionId: string): SessionV2 {
    const session = this.store.get(sessionId);
    if (!session) {
      throw new BCPErrorV2(
        BCPErrorCodeV2.UNKNOWN_SESSION,
        `No session found: ${sessionId}`
      );
    }
    return session;
  }

  private assertTransition(session: SessionV2, messageType: string): void {
    const allowed = TRANSITIONS[session.state];
    if (!allowed[messageType]) {
      throw new BCPErrorV2(
        BCPErrorCodeV2.INVALID_STATE,
        `Cannot send ${messageType} in state ${session.state}`,
        { current_state: session.state, attempted_transition: messageType }
      );
    }
  }
}
