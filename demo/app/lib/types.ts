/** SSE event types streamed from /api/demo to the UI */

export type MessageType = 'INTENT' | 'QUOTE' | 'COUNTER' | 'COMMIT' | 'FULFIL' | 'DISPUTE' | 'RESOLVE';
export type EventSender = 'buyer' | 'seller';

export interface DemoEvent {
  type: 'message' | 'x402' | 'balance' | 'status' | 'error' | 'done' | 'reasoning';
  timestamp: number;
}

/** AI reasoning shown before the protocol message */
export interface ReasoningEvent extends DemoEvent {
  type: 'reasoning';
  sender: EventSender;
  agentName: string;
  thought: string;
  action: string;
}

export interface MessageEvent extends DemoEvent {
  type: 'message';
  messageType: MessageType;
  sender: EventSender;
  id: string;
  summary: string;
  detail: Record<string, unknown>;
  detailRows?: { label: string; value: string }[];
  txHash?: string;
  explorerUrl?: string;
}

export interface X402Event extends DemoEvent {
  type: 'x402';
  step: 'request' | 'challenge' | 'signed' | 'settled';
  detail: Record<string, string>;
}

export interface BalanceEvent extends DemoEvent {
  type: 'balance';
  buyer: string;
  seller: string;
}

export interface StatusEvent extends DemoEvent {
  type: 'status';
  text: string;
}

export interface ErrorEvent extends DemoEvent {
  type: 'error';
  message: string;
}

export interface DoneEvent extends DemoEvent {
  type: 'done';
  lockTxHash: string;
  releaseTxHash: string;
  resetTxHash: string;
  lockUrl: string;
  releaseUrl: string;
  resetUrl: string;
  invoiceId: string;
  invoiceXml?: string;
  price: string;
  elapsed: number;
  gasCost: string;
}

export type AnyDemoEvent =
  | ReasoningEvent
  | MessageEvent
  | X402Event
  | BalanceEvent
  | StatusEvent
  | ErrorEvent
  | DoneEvent;
