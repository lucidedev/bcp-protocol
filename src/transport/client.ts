/**
 * BCP transport client — HTTP client for sending BCP messages to POST /bcp.
 * @module transport/client
 */

import type { BCPMessage } from '../messages/types';
import { signMessage } from '../validation/signature';
import { validateMessage } from '../validation/validator';

/** Client configuration */
export interface BCPClientConfig {
  /** Base URL of the BCP server (e.g. http://localhost:3000) */
  baseUrl: string;
  /** Ed25519 private key for signing outbound messages (hex string) */
  privateKey?: string;
}

/** Server response for accepted messages */
export interface BCPResponse {
  accepted: boolean;
  sessionId: string;
  session_state: string;
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

/**
 * BCP protocol client for sending messages to a BCP server via POST /bcp.
 */
export class BCPClient {
  private config: BCPClientConfig;

  constructor(config: BCPClientConfig) {
    this.config = config;
  }

  /**
   * Send a BCP message to the server. Validates, optionally signs,
   * and POSTs to /bcp.
   */
  async send(message: Record<string, unknown>): Promise<BCPResponse> {
    // Validate before sending (allow missing signature)
    const check = { ...message };
    if (!check.signature) delete check.signature;
    const validation = validateMessage({ ...check, signature: check.signature || 'placeholder' });
    if (!validation.valid) {
      const realErrors = validation.errors.filter(e => e.path !== '/signature');
      if (realErrors.length > 0) {
        throw new Error(
          `Message validation failed: ${realErrors.map(e => `${e.path}: ${e.message}`).join(', ')}`
        );
      }
    }

    // Sign if private key is provided
    let signedMessage = message;
    if (this.config.privateKey) {
      const signature = signMessage(message, this.config.privateKey);
      signedMessage = { ...message, signature };
    }

    // Send to unified /bcp endpoint
    const url = `${this.config.baseUrl}/bcp`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signedMessage),
    });

    const body = await response.json() as BCPResponse | BCPErrorResponse;

    if (!response.ok) {
      const errBody = body as BCPErrorResponse;
      throw new Error(
        `BCP server error [${errBody.error.code}]: ${errBody.error.message}`
      );
    }

    return body as BCPResponse;
  }
}

/**
 * Create a "local" client that talks to an Express app directly (for testing).
 */
export function createLocalClient(app: import('express').Application): BCPClient {
  // Start temporary server
  let port = 0;
  const server = app.listen(0, () => {
    const addr = server.address();
    if (addr && typeof addr !== 'string') port = addr.port;
  });

  const client = new BCPClient({ baseUrl: `http://localhost:${port}` });

  // Attach close function
  (client as unknown as Record<string, unknown>)['close'] = () => {
    server.close();
  };

  return client;
}
