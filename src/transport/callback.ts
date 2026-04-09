/**
 * BCP v0.3 Transport — async callback delivery + unified /bcp endpoint.
 *
 * When a message includes `callbackUrl`, the server POSTs the response
 * message to that URL instead of returning it in the HTTP body.
 *
 * @module transport/callback
 */

import type { BCPMessage } from '../messages/types';

/** Result of a callback delivery attempt */
export interface CallbackResult {
  delivered: boolean;
  statusCode?: number;
  error?: string;
}

/**
 * Deliver a BCP response message to the sender's callbackUrl.
 *
 * If the original message had a `callbackUrl`, the response should be
 * POSTed there asynchronously instead of returned in the HTTP body.
 *
 * @param callbackUrl - The URL to POST the response to
 * @param message - The BCP response message to deliver
 * @param signature - Optional Ed25519 signature to include
 * @returns Result of the delivery attempt
 */
export async function deliverCallback(
  callbackUrl: string,
  message: BCPMessage,
  signature?: string,
): Promise<CallbackResult> {
  const body = signature ? { ...message, signature } : message;

  try {
    const response = await fetch(callbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-BCP-Version': '0.3',
      },
      body: JSON.stringify(body),
    });

    return {
      delivered: response.ok,
      statusCode: response.status,
      error: response.ok ? undefined : `HTTP ${response.status}`,
    };
  } catch (err) {
    return {
      delivered: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Check if a message requests async delivery.
 */
export function wantsCallback(message: BCPMessage | Record<string, unknown>): string | undefined {
  const url = message.callbackUrl as string | undefined;
  return url && typeof url === 'string' ? url : undefined;
}
