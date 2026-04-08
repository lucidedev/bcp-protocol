/**
 * BCP transport client — HTTP client for sending BCP messages.
 * @module transport/client
 */

import { BCPMessage } from '../state/session';
import { signMessage } from '../validation/signature';
import { validateMessage } from '../validation/validator';

/** Client configuration */
export interface BCPClientConfig {
  /** Base URL of the BCP server (e.g. http://localhost:3000) */
  baseUrl: string;
  /** Private key for signing outbound messages (hex string) */
  privateKey: string;
}

/** Server response for accepted messages */
export interface BCPResponse {
  /** Whether the message was accepted */
  accepted: boolean;
  /** The ID assigned to the message */
  message_id: string;
  /** Current session state */
  session_state: string;
  /** Optional response message from the server */
  response?: BCPMessage;
}

/** Error response from server */
export interface BCPErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/** Message type to endpoint path mapping */
const ENDPOINT_MAP: Record<string, string> = {
  INTENT: '/bcp/intent',
  QUOTE: '/bcp/quote',
  COUNTER: '/bcp/counter',
  COMMIT: '/bcp/commit',
  FULFIL: '/bcp/fulfil',
  DISPUTE: '/bcp/dispute',
};

/**
 * BCP protocol client for sending signed messages to a BCP server.
 */
export class BCPClient {
  private config: BCPClientConfig;

  constructor(config: BCPClientConfig) {
    this.config = config;
  }

  /**
   * Send a BCP message to the server. The message will be validated,
   * signed, and POSTed to the appropriate endpoint.
   *
   * @param message - The BCP message to send (without signature)
   * @returns Server response
   * @throws Error on validation failure or network error
   */
  async send(message: Record<string, unknown>): Promise<BCPResponse> {
    // Validate before sending
    const messageWithPlaceholderSig = { ...message, signature: 'placeholder' };
    const validation = validateMessage(messageWithPlaceholderSig);
    if (!validation.valid) {
      // Check only non-signature errors
      const realErrors = validation.errors.filter(e => e.path !== '/signature');
      if (realErrors.length > 0) {
        throw new Error(
          `Message validation failed: ${realErrors.map(e => `${e.path}: ${e.message}`).join(', ')}`
        );
      }
    }

    // Sign the message
    const signature = signMessage(message, this.config.privateKey);
    const signedMessage = { ...message, signature };

    // Determine endpoint
    const messageType = message.message_type as string;
    const path = ENDPOINT_MAP[messageType];
    if (!path) {
      throw new Error(`Unknown message type: ${messageType}`);
    }

    // Send HTTP POST
    const url = `${this.config.baseUrl}${path}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signedMessage),
    });

    const body = await response.json() as BCPResponse | BCPErrorResponse;

    if (!response.ok) {
      const errBody = body as BCPErrorResponse;
      throw new Error(
        `BCP server error ${response.status}: [${errBody.error?.code}] ${errBody.error?.message}`
      );
    }

    return body as BCPResponse;
  }
}

/**
 * Create a BCP client configured to talk to a local server.
 * @param port - The port the server is running on
 * @param privateKey - The private key for signing messages
 * @returns Configured BCP client
 */
export function createLocalClient(port: number, privateKey: string): BCPClient {
  return new BCPClient({
    baseUrl: `http://localhost:${port}`,
    privateKey,
  });
}
