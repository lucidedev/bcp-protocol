/**
 * BCP — Business Commerce Protocol
 *
 * Main entry point — re-exports all public types, interfaces, and classes.
 * @module bcp
 */

// Message types
export { IntentMessage, Buyer, Requirements, PaymentTerms } from './messages/intent';
export { QuoteMessage, Seller, LineItem, Offer, EarlyPayDiscount } from './messages/quote';
export { CounterMessage, ProposedChanges } from './messages/counter';
export { CommitMessage, BuyerApproval, PaymentSchedule, Escrow } from './messages/commit';
export { FulfilMessage, DeliveryProof, Invoice } from './messages/fulfil';
export { DisputeMessage } from './messages/dispute';

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
  BCPMessage,
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

// Transport
export { createBCPServer, BCPServerConfig, MessageHandler } from './transport/server';
export { BCPClient, BCPClientConfig, BCPResponse, createLocalClient } from './transport/client';

// SDK — high-level API
export { BCP, BCPConfig, TransactParams, DealResult } from './sdk';

// Split SDK — separate buyer/seller (production architecture)
export { BCPBuyer, BCPBuyerConfig, PurchaseParams, BuyerDealResult, DisputeParams, DisputeResult, UnfreezeResult, NETWORKS, NetworkConfig, RFQParams, RFQQuote, RFQResult } from './buyer';
export { BCPSeller, BCPSellerConfig, SellerListenOptions, SellerDealResult, PricingStrategy } from './seller';
