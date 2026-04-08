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
  commitId?: string;
  intentId?: string;
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
    throw new Error(
      'Set BUYER_EVM_PRIVATE_KEY env var. The MCP server needs it to sign transactions.'
    );
  }
  if (!contractAddress) {
    throw new Error(
      'Set BCP_ESCROW_CONTRACT_ADDRESS env var (deployed BCPEscrow contract).'
    );
  }

  buyer = new BCPBuyer({ network, evmPrivateKey, contractAddress });
  return buyer;
}

// ── Create MCP server ──────────────────────────────────────────────

const server = new McpServer({
  name: 'bcp-commerce',
  version: '0.1.0',
});

// ── Tool: bcp_purchase ─────────────────────────────────────────────

server.tool(
  'bcp_purchase',
  'Execute a full B2B purchase: INTENT → QUOTE → COMMIT → FULFIL. ' +
  'Negotiates with a seller, locks escrow on-chain, and waits for delivery.',
  {
    seller_url: z.string().describe('Seller BCP server URL (e.g. http://seller.example.com:3001)'),
    item_description: z.string().describe('What to buy (e.g. "500 units of premium API credits")'),
    quantity: z.number().positive().describe('Number of units'),
    budget_max: z.number().positive().describe('Maximum budget in USDC'),
    org_id: z.string().optional().describe('Buyer organization ID'),
    payment_terms: z.enum(['immediate', 'net15', 'net30', 'net45', 'net60', 'net90']).optional()
      .describe('Payment terms (default: immediate)'),
    max_accept_price: z.number().optional().describe('Auto-accept if total ≤ this price'),
    counter_price: z.number().optional().describe('Counter-offer price (triggers negotiation)'),
  },
  async (params) => {
    try {
      const b = getBuyer();

      const purchaseParams: PurchaseParams = {
        seller: params.seller_url,
        orgId: params.org_id,
        item: {
          description: params.item_description,
          qty: params.quantity,
        },
        budget: params.budget_max,
        terms: params.payment_terms as PurchaseParams['terms'],
        maxAcceptPrice: params.max_accept_price,
        counterPrice: params.counter_price,
      };

      const deal = await b.purchase(purchaseParams);

      // Track session
      sessions.set(deal.commitId, {
        sellerUrl: params.seller_url,
        commitId: deal.commitId,
        intentId: deal.intentId,
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
              commitId: deal.commitId,
              intentId: deal.intentId,
              price: deal.price,
              currency: deal.currency,
              state: deal.state,
              lockTxHash: deal.lockTxHash,
              lockUrl: deal.lockUrl,
              releaseTxHash: deal.releaseTxHash,
              releaseUrl: deal.releaseUrl,
              invoiceId: deal.invoiceId,
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
  'Raise a dispute on a committed deal. Freezes escrow on-chain. ' +
  'Both parties must agree (approveUnfreeze) to release funds after a dispute.',
  {
    seller_url: z.string().describe('Seller BCP server URL'),
    commit_id: z.string().describe('The commit_id of the deal to dispute'),
    reason: z.enum(['partial_delivery', 'non_delivery', 'quality_issue', 'payment_failure', 'other'])
      .describe('Why the dispute is being raised'),
    requested_resolution: z.enum(['full_refund', 'partial_refund', 'redeliver', 'negotiate'])
      .describe('What resolution the buyer is requesting'),
    evidence_hash: z.string().optional().describe('SHA-256 hash of evidence'),
    evidence_url: z.string().optional().describe('URL to evidence document'),
  },
  async (params) => {
    try {
      const b = getBuyer();

      const result = await b.dispute({
        seller: params.seller_url,
        commitId: params.commit_id,
        reason: params.reason,
        requestedResolution: params.requested_resolution,
        evidenceHash: params.evidence_hash,
        evidenceUrl: params.evidence_url,
      });

      // Update session state
      const session = sessions.get(params.commit_id);
      if (session) session.state = 'DISPUTED';

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            dispute: {
              disputeId: result.disputeId,
              commitId: result.commitId,
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
  'Approve unfreezing a disputed escrow (buyer side). Requires both buyer AND seller ' +
  'to call approveUnfreeze before funds are released.',
  {
    commit_id: z.string().describe('The commit_id of the disputed deal'),
  },
  async (params) => {
    try {
      const b = getBuyer();

      const result = await b.approveUnfreeze(params.commit_id);

      const session = sessions.get(params.commit_id);
      if (session && result.fullyUnfrozen) session.state = 'COMMITTED';

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            unfreeze: {
              commitId: result.commitId,
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
  'List all active BCP deal sessions tracked by this server.',
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

// ── Resource: protocol spec ────────────────────────────────────────

server.resource(
  'bcp-spec',
  'bcp://spec/erc-bcp',
  async () => {
    const fs = await import('fs');
    const path = await import('path');
    const specPath = path.join(__dirname, '../../spec/ERC-BCP.md');
    const content = fs.readFileSync(specPath, 'utf-8');
    return {
      contents: [{
        uri: 'bcp://spec/erc-bcp',
        mimeType: 'text/markdown',
        text: content,
      }],
    };
  }
);

// ── Start ──────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info('BCP MCP server running on stdio');
}

main().catch((err) => {
  console.error('BCP MCP server failed to start:', err);
  process.exit(1);
});
