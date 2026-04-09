#!/usr/bin/env node
/**
 * BCP MCP Server — Expose BCP commerce operations as MCP tools.
 *
 * Any AI agent with MCP support (Claude, GPT, etc.) can use this server
 * to negotiate, commit, dispute, and fulfil B2B deals on behalf of a buyer.
 *
 * Run:
 *   npx ts-node src/mcp/server.ts
 *   # or after build:
 *   node dist/src/mcp/server.js
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { BCPBuyer } from '../buyer';
import type { PurchaseParams, DisputeParams } from '../buyer';
import { createLogger } from '../logger';

const log = createLogger('bcp-mcp');

// ── In-memory session store for active deals ───────────────────────

interface ActiveSession {
  sellerUrl: string;
  sessionId?: string;
  price?: number;
  currency?: string;
  state: string;
  createdAt: string;
}

const sessions = new Map<string, ActiveSession>();

// ── Lazy buyer instance (created on first tool use) ────────────────

let buyer: BCPBuyer | null = null;

function getBuyer(): BCPBuyer {
  if (buyer) return buyer;

  const network = process.env.BCP_NETWORK || 'base-sepolia';
  const evmPrivateKey = process.env.BUYER_EVM_PRIVATE_KEY;
  const contractAddress = process.env.BCP_ESCROW_CONTRACT_ADDRESS;

  if (!evmPrivateKey) {
    throw new Error('Set BUYER_EVM_PRIVATE_KEY env var.');
  }
  if (!contractAddress) {
    throw new Error('Set BCP_ESCROW_CONTRACT_ADDRESS env var.');
  }

  buyer = new BCPBuyer({ network, evmPrivateKey, contractAddress });
  return buyer;
}

// ── Create MCP server ──────────────────────────────────────────────

const server = new McpServer({
  name: 'bcp-commerce',
  version: '0.3.0',
});

// ── Tool: bcp_purchase ─────────────────────────────────────────────

server.tool(
  'bcp_purchase',
  'Execute a full purchase: INTENT → QUOTE → COMMIT → FULFIL. ' +
  'Negotiates with a seller, locks escrow on-chain, and waits for delivery.',
  {
    seller_url: z.string().describe('Seller BCP server URL'),
    service: z.string().describe('What to buy (natural language description)'),
    budget: z.number().positive().optional().describe('Maximum budget in USDC'),
    currency: z.string().optional().describe('Currency (default: USDC)'),
    counter_price: z.number().optional().describe('Counter-offer price'),
  },
  async (params) => {
    try {
      const b = getBuyer();

      const purchaseParams: PurchaseParams = {
        seller: params.seller_url,
        service: params.service,
        budget: params.budget,
        currency: params.currency,
        counterPrice: params.counter_price,
      };

      const deal = await b.purchase(purchaseParams);

      sessions.set(deal.sessionId, {
        sellerUrl: params.seller_url,
        sessionId: deal.sessionId,
        price: deal.price,
        currency: deal.currency,
        state: deal.state,
        createdAt: new Date().toISOString(),
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            deal: {
              sessionId: deal.sessionId,
              price: deal.price,
              currency: deal.currency,
              state: deal.state,
              lockTxHash: deal.lockTxHash,
              lockUrl: deal.lockUrl,
              releaseTxHash: deal.releaseTxHash,
              releaseUrl: deal.releaseUrl,
            },
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        }],
        isError: true,
      };
    }
  }
);

// ── Tool: bcp_dispute ──────────────────────────────────────────────

server.tool(
  'bcp_dispute',
  'Raise a dispute on a committed deal. Freezes escrow on-chain.',
  {
    seller_url: z.string().describe('Seller BCP server URL'),
    session_id: z.string().describe('The sessionId of the deal to dispute'),
    reason: z.string().describe('Why the dispute is being raised'),
    resolution: z.enum(['refund', 'redeliver', 'negotiate']).optional()
      .describe('Requested resolution'),
  },
  async (params) => {
    try {
      const b = getBuyer();

      const result = await b.dispute({
        seller: params.seller_url,
        sessionId: params.session_id,
        reason: params.reason,
        resolution: params.resolution,
      });

      const session = sessions.get(params.session_id);
      if (session) session.state = 'disputed';

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            dispute: {
              sessionId: result.sessionId,
              freezeTxHash: result.freezeTxHash,
              freezeUrl: result.freezeUrl,
            },
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        }],
        isError: true,
      };
    }
  }
);

// ── Tool: bcp_approve_unfreeze ─────────────────────────────────────

server.tool(
  'bcp_approve_unfreeze',
  'Approve unfreezing a disputed escrow (buyer side).',
  {
    session_id: z.string().describe('The sessionId of the disputed deal'),
  },
  async (params) => {
    try {
      const b = getBuyer();

      const result = await b.approveUnfreeze(params.session_id);

      const session = sessions.get(params.session_id);
      if (session && result.fullyUnfrozen) session.state = 'committed';

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            unfreeze: {
              sessionId: result.sessionId,
              approvalTxHash: result.approvalTxHash,
              approvalUrl: result.approvalUrl,
              fullyUnfrozen: result.fullyUnfrozen,
            },
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        }],
        isError: true,
      };
    }
  }
);

// ── Tool: bcp_sessions ─────────────────────────────────────────────

server.tool(
  'bcp_sessions',
  'List all active BCP deal sessions.',
  {},
  async () => {
    const list = Array.from(sessions.entries()).map(([id, s]) => ({
      id,
      ...s,
    }));

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          success: true,
          count: list.length,
          sessions: list,
        }, null, 2),
      }],
    };
  }
);

// ── Connect via stdio ──────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info('BCP MCP server running via stdio');
}

main().catch((err) => {
  log.error('Failed to start MCP server', { error: err });
  process.exit(1);
});
