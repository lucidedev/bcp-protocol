/**
 * A2A Agent Card Bridge — declare BCP capabilities in A2A Agent Cards.
 *
 * The Google A2A protocol discovers agents via Agent Cards at
 * `/.well-known/agent.json`. This module generates the BCP commerce
 * extension for Agent Cards and maps between A2A tasks and BCP sessions.
 *
 * @module a2a/agent-card
 */

import type { BCPMessage, IntentMessage } from '../messages/types';
import { toDIDKey } from '../identity/did';
import { v4 as uuid } from 'uuid';

// ── A2A Agent Card types ───────────────────────────────────────────

/** Minimal A2A Agent Card structure (per google/A2A spec) */
export interface A2AAgentCard {
  name: string;
  description: string;
  url: string;
  version: string;
  capabilities?: A2ACapabilities;
  skills?: A2ASkill[];
  /** BCP commerce extension */
  'x-bcp'?: BCPCardExtension;
}

export interface A2ACapabilities {
  streaming?: boolean;
  pushNotifications?: boolean;
  stateTransitionHistory?: boolean;
}

export interface A2ASkill {
  id: string;
  name: string;
  description: string;
  tags?: string[];
  examples?: string[];
}

/** BCP extension fields for an A2A Agent Card */
export interface BCPCardExtension {
  /** BCP protocol version supported */
  protocolVersion: '0.3';
  /** BCP endpoint URL */
  endpointUrl: string;
  /** Settlement methods this agent supports */
  settlement: string[];
  /** Auth modes this agent supports */
  auth: string[];
  /** Agent's DID key for signature verification */
  did?: string;
  /** Currency codes accepted */
  currencies?: string[];
  /** Human-readable pricing hint */
  pricingHint?: string;
}

// ── A2A Task types ─────────────────────────────────────────────────

/** A2A task states (subset relevant to BCP mapping) */
export type A2ATaskState =
  | 'submitted'
  | 'working'
  | 'input-required'
  | 'completed'
  | 'canceled'
  | 'failed';

/** Minimal A2A task for BCP mapping */
export interface A2ATask {
  id: string;
  sessionId: string;
  status: {
    state: A2ATaskState;
    message?: { role: string; parts: { text: string }[] };
  };
  metadata?: Record<string, unknown>;
}

// ── Card Generation ────────────────────────────────────────────────

/** Options for generating a BCP agent card extension */
export interface BCPCardOptions {
  /** Base URL of the agent's BCP endpoint */
  endpointUrl: string;
  /** Supported settlement methods (default: ['none', 'escrow']) */
  settlement?: string[];
  /** Supported auth modes (default: ['none', 'ed25519']) */
  auth?: string[];
  /** Agent's Ed25519 public key (hex) — will be converted to did:key */
  publicKeyHex?: string;
  /** Accepted currencies (default: ['USD']) */
  currencies?: string[];
  /** Pricing hint for discovery */
  pricingHint?: string;
}

/**
 * Generate the BCP extension block for an A2A Agent Card.
 *
 * @example
 * ```ts
 * const card: A2AAgentCard = {
 *   name: 'Logo Designer Agent',
 *   description: 'Creates minimalist logos',
 *   url: 'https://agent.example.com',
 *   version: '1.0',
 *   'x-bcp': generateBCPCardExtension({
 *     endpointUrl: 'https://agent.example.com/bcp',
 *     publicKeyHex: '...',
 *     pricingHint: '$50-500 per logo',
 *   }),
 * };
 * ```
 */
export function generateBCPCardExtension(options: BCPCardOptions): BCPCardExtension {
  return {
    protocolVersion: '0.3',
    endpointUrl: options.endpointUrl,
    settlement: options.settlement ?? ['none', 'escrow'],
    auth: options.auth ?? ['none', 'ed25519'],
    did: options.publicKeyHex ? toDIDKey(options.publicKeyHex) : undefined,
    currencies: options.currencies ?? ['USD'],
    pricingHint: options.pricingHint,
  };
}

// ── A2A ↔ BCP Mapping ─────────────────────────────────────────────

/** Map BCP session state → A2A task state */
const BCP_TO_A2A_STATE: Record<string, A2ATaskState> = {
  initiated:  'submitted',
  quoted:     'input-required',
  countered:  'input-required',
  committed:  'working',
  fulfilled:  'completed',
  accepted:   'completed',
  disputed:   'failed',
};

/**
 * Convert a BCP session state to an A2A task state.
 */
export function bcpStateToA2A(bcpState: string): A2ATaskState {
  return BCP_TO_A2A_STATE[bcpState] ?? 'working';
}

/**
 * Convert an A2A `tasks/send` request into a BCP INTENT message.
 *
 * This is the inbound bridge: an A2A client sends a task,
 * and we convert it to a BCP session initiation.
 *
 * @param taskRequest - The A2A tasks/send body
 * @returns BCP INTENT message ready to process
 */
export function a2aTaskToIntent(taskRequest: {
  id?: string;
  message: { role: string; parts: { text: string }[] };
  metadata?: Record<string, unknown>;
}): IntentMessage {
  const serviceText = taskRequest.message.parts
    .map(p => p.text)
    .join('\n');

  return {
    bcp_version: '0.3',
    type: 'intent',
    sessionId: taskRequest.id ?? `bcp_${uuid().replace(/-/g, '').slice(0, 12)}`,
    timestamp: new Date().toISOString(),
    service: serviceText,
    budget: taskRequest.metadata?.budget as number | undefined,
    currency: (taskRequest.metadata?.currency as string) ?? 'USD',
    auth: (taskRequest.metadata?.auth as IntentMessage['auth']) ?? 'none',
  };
}

/**
 * Convert a BCP session state change to an A2A task status update.
 *
 * This is the outbound bridge: BCP session advances,
 * and we emit an A2A-compatible task update.
 *
 * @param sessionId - BCP session ID
 * @param bcpState - Current BCP state
 * @param lastMessage - Last BCP message in the session
 * @returns A2A task object
 */
export function bcpSessionToA2ATask(
  sessionId: string,
  bcpState: string,
  lastMessage?: BCPMessage,
): A2ATask {
  let statusText = `BCP session in state: ${bcpState}`;

  if (lastMessage) {
    switch (lastMessage.type) {
      case 'quote':
        statusText = `Quote: ${lastMessage.price} ${lastMessage.currency}`;
        break;
      case 'counter':
        statusText = `Counter-offer: ${lastMessage.counterPrice}`;
        break;
      case 'commit':
        statusText = `Committed at ${lastMessage.agreedPrice} ${lastMessage.currency}`;
        break;
      case 'fulfil':
        statusText = lastMessage.summary ?? 'Delivery complete';
        break;
      case 'accept':
        statusText = lastMessage.feedback ?? 'Buyer confirmed receipt';
        break;
      case 'dispute':
        statusText = `Dispute: ${lastMessage.reason}`;
        break;
    }
  }

  return {
    id: sessionId,
    sessionId,
    status: {
      state: bcpStateToA2A(bcpState),
      message: {
        role: 'agent',
        parts: [{ text: statusText }],
      },
    },
    metadata: lastMessage ? { bcpState, bcpMessageType: lastMessage.type } : { bcpState },
  };
}
