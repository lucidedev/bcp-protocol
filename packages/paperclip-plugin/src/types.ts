export type DealStatus =
  | "quoted"
  | "negotiating"
  | "committed"
  | "fulfilled"
  | "disputed"
  | "rejected";

export interface Deal {
  sessionId: string;
  role: "buyer" | "seller";
  status: DealStatus;
  service: string;
  counterpartyUrl: string;
  price?: number;
  currency: string;
  deliverables?: string[];
  estimatedDays?: number;
  counterHistory?: Array<{ price: number; by: "buyer" | "seller"; at: string }>;
  createdAt: string;
  updatedAt: string;
  fulfilledAt?: string;
}

/**
 * BCP v0.2 wire message. Standard BCP envelope fields live at the top level;
 * the `payload` bag carries type-specific data that maps 1:1 to v0.2 fields
 * (e.g. payload.price → QuoteMessageV2.price).
 */
export interface BcpMessage {
  bcp_version?: "0.2";
  type:
    | "intent"
    | "quote"
    | "counter"
    | "commit"
    | "fulfil"
    | "dispute"
    | "check_status"
    | "reject"
    | "ack"
    | "status";
  sessionId: string;
  timestamp?: string;
  callbackUrl?: string;
  payload: Record<string, unknown>;
}

export interface ServiceConfig {
  name: string;
  description?: string;
  basePrice: number;
  currency?: string;
  estimatedDays?: number;
  deliverables?: string[];
}

export interface KnownSeller {
  name: string;
  url: string;
  services?: string[];
}

export interface PluginConfig {
  services: ServiceConfig[];
  autoQuote: boolean;
  autoAcceptCommit: boolean;
  maxAutoApprove: number;
  currency: string;
  knownSellers: KnownSeller[];
}
