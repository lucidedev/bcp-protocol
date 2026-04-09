/**
 * BCP — Business Commerce Protocol
 *
 * Main entry point — re-exports all public types, interfaces, and classes.
 * @module bcp
 */

// Message types
export type {
  AuthMode,
  Settlement,
  BCPEnvelope,
  IntentMessage,
  QuoteMessage,
  CounterMessage,
  CommitMessage,
  FulfilMessage,
  AcceptMessage,
  DisputeMessage,
  BCPMessage,
} from './messages/types';

// Validation
export {
  validateMessage,
  validateMessageType,
  ValidationResult,
  ValidationError,
  BCPMessageType,
} from './validation/validator';
export {
  signMessage,
  verifyMessage,
  generateKeypair,
  getPublicKey,
  getSigningPayload,
  deepCanonicalJson,
  canonicalJson,
} from './validation/signature';

// State machine
export {
  SessionManager,
  Session,
  SessionState,
  SessionStore,
  InMemorySessionStore,
  BCPError,
  BCPErrorCode,
} from './state/session';

// Escrow
export {
  EscrowProvider,
  EscrowReceipt,
  ReleaseReceipt,
  FreezeReceipt,
  UnfreezeApproval,
} from './escrow/escrow';
export {
  OnChainEscrowProvider,
  OnChainEscrowConfig,
} from './escrow/onchain-escrow';
export {
  X402FundedEscrowProvider,
  X402FundedEscrowConfig,
} from './escrow/x402-funded-escrow';

// Settlement
export {
  X402Bridge,
  X402Config,
  X402PaymentResult,
  ScheduledPayment,
} from './settlement/x402-bridge';

// Invoice
export { generateUBLInvoice, UBLInvoiceResult } from './invoice/ubl-generator';

// Logger
export {
  Logger,
  LogLevel,
  LogEntry,
  LogTransport,
  configureLogger,
  createLogger,
} from './logger';

// Identity
export {
  loadIdentities,
  AgentIdentity,
} from './identity/keys';

// DID key conversion
export {
  toDIDKey,
  fromDIDKey,
  isDIDKey,
} from './identity/did';

// A2A Agent Card bridge
export {
  generateBCPCardExtension,
  bcpStateToA2A,
  a2aTaskToIntent,
  bcpSessionToA2ATask,
  A2AAgentCard,
  A2ATask,
  A2ATaskState,
  BCPCardExtension,
  BCPCardOptions,
} from './a2a/agent-card';

// Transport
export { createBCPServer, BCPServerConfig, MessageHandler } from './transport/server';
export { BCPClient, BCPClientConfig, BCPResponse, createLocalClient } from './transport/client';
export { deliverCallback, wantsCallback, CallbackResult } from './transport/callback';

// SDK — high-level API
export { BCP, BCPConfig, TransactParams, DealResult } from './sdk';

// Split SDK — separate buyer/seller (production architecture)
export { BCPBuyer, BCPBuyerConfig, PurchaseParams, BuyerDealResult, DisputeParams, DisputeResult, UnfreezeResult, NETWORKS, NetworkConfig, RFQParams, RFQQuote, RFQResult } from './buyer';
export { BCPSeller, BCPSellerConfig, SellerListenOptions, SellerDealResult, PricingStrategy } from './seller';
