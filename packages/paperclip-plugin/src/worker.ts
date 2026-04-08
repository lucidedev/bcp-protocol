import { randomUUID } from "node:crypto";
import {
  definePlugin,
  runWorker,
  type PluginWebhookInput,
} from "@paperclipai/plugin-sdk";
import { TOOL_NAMES, WEBHOOK_KEYS, PLUGIN_NAME } from "./constants.js";
import type {
  BcpMessage,
  Deal,
  PluginConfig,
  ServiceConfig,
  KnownSeller,
} from "./types.js";

// Module-level context reference — set during setup, used by onWebhook
let _ctx: Parameters<Parameters<typeof definePlugin>[0]["setup"]>[0];

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateSessionId(): string {
  return `bcp_${randomUUID().slice(0, 12)}`;
}

function matchService(
  description: string,
  services: ServiceConfig[],
): ServiceConfig | null {
  if (services.length === 0) return null;
  const lower = description.toLowerCase();
  let best: ServiceConfig | null = null;
  let bestScore = 0;
  for (const svc of services) {
    const words = svc.name.toLowerCase().split(/\s+/);
    const descWords = svc.description?.toLowerCase().split(/\s+/) ?? [];
    const allWords = [...words, ...descWords];
    const score = allWords.filter((w) => lower.includes(w)).length;
    if (score > bestScore) {
      bestScore = score;
      best = svc;
    }
  }
  return best ?? services[0]!;
}

// ── Shared helpers (use _ctx, set during setup) ─────────────────────────────

async function getConfig(): Promise<PluginConfig> {
  const raw = (await _ctx.config.get()) as Record<string, unknown> | null;
  return {
    services: (raw?.services as ServiceConfig[]) ?? [],
    autoQuote: (raw?.autoQuote as boolean) ?? true,
    autoAcceptCommit: (raw?.autoAcceptCommit as boolean) ?? true,
    maxAutoApprove: (raw?.maxAutoApprove as number) ?? 500,
    currency: (raw?.currency as string) ?? "USD",
    knownSellers: (raw?.knownSellers as KnownSeller[]) ?? [],
  };
}

async function getDeal(sessionId: string): Promise<Deal | null> {
  return (await _ctx.state.get({
    scopeKind: "instance",
    stateKey: `deal:${sessionId}`,
  })) as Deal | null;
}

async function saveDeal(deal: Deal): Promise<void> {
  deal.updatedAt = new Date().toISOString();
  await _ctx.state.set(
    { scopeKind: "instance", stateKey: `deal:${deal.sessionId}` },
    deal,
  );
}

async function addDealToIndex(sessionId: string): Promise<void> {
  const idx =
    ((await _ctx.state.get({
      scopeKind: "instance",
      stateKey: "deals:index",
    })) as string[]) ?? [];
  if (!idx.includes(sessionId)) {
    idx.push(sessionId);
    await _ctx.state.set(
      { scopeKind: "instance", stateKey: "deals:index" },
      idx,
    );
  }
}

async function sendBcp(url: string, msg: BcpMessage): Promise<BcpMessage> {
  const envelope: BcpMessage = {
    bcp_version: "0.2",
    ...msg,
    timestamp: msg.timestamp ?? new Date().toISOString(),
  };
  const resp = await _ctx.http.fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(envelope),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`BCP ${resp.status}: ${text}`);
  }
  return (await resp.json()) as BcpMessage;
}

// ── Plugin ───────────────────────────────────────────────────────────────────

const plugin = definePlugin({
  async setup(ctx) {
    _ctx = ctx;
    ctx.logger.info(`${PLUGIN_NAME} starting`);

    // ═══════════════════════════════════════════════════════════════════════
    //  BUYER TOOLS
    // ═══════════════════════════════════════════════════════════════════════

    // 1 ── Request Quote ──────────────────────────────────────────────────

    ctx.tools.register(
      TOOL_NAMES.requestQuote,
      {
        displayName: "Request Quote from Company",
        description:
          "Send a request for quote to another Paperclip company. " +
          "Provide what service you need and the seller's commerce endpoint URL. " +
          "The seller will respond with pricing and deliverables.",
        parametersSchema: {
          type: "object",
          properties: {
            service: {
              type: "string",
              description:
                "What you need (e.g. 'Logo design for a fintech startup, modern minimalist style')",
            },
            sellerUrl: {
              type: "string",
              description: "The seller company's BCP commerce endpoint URL",
            },
            budget: {
              type: "number",
              description: "Maximum budget in USD (optional)",
            },
          },
          required: ["service", "sellerUrl"],
        },
      },
      async (params) => {
        const { service, sellerUrl, budget } = params as {
          service: string;
          sellerUrl: string;
          budget?: number;
        };
        const config = await getConfig();
        const sessionId = generateSessionId();

        const intent: BcpMessage = {
          type: "intent",
          sessionId,
          payload: {
            service,
            budget: budget ?? config.maxAutoApprove,
            currency: config.currency,
          },
        };

        try {
          const response = await sendBcp(sellerUrl, intent);

          if (response.type === "reject") {
            return {
              content:
                `Seller declined: ${response.payload.reason ?? "No matching service available"}. ` +
                `Try a different company or rephrase the request.`,
            };
          }

          if (response.type !== "quote") {
            return {
              error: `Unexpected response type "${response.type}". The seller may not have the commerce plugin installed.`,
            };
          }

          const deal: Deal = {
            sessionId,
            role: "buyer",
            status: "quoted",
            service,
            counterpartyUrl: sellerUrl,
            price: response.payload.price as number,
            currency:
              (response.payload.currency as string) ?? config.currency,
            deliverables: response.payload.deliverables as string[],
            estimatedDays: response.payload.estimatedDays as number,
            counterHistory: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };

          await saveDeal(deal);
          await addDealToIndex(sessionId);

          const delivStr = deal.deliverables?.length
            ? deal.deliverables.join(", ")
            : "Not specified";

          return {
            content: [
              `Quote received!`,
              ``,
              `  Service: ${service}`,
              `  Price: $${deal.price} ${deal.currency}`,
              `  Deliverables: ${delivStr}`,
              `  Estimated delivery: ${deal.estimatedDays ?? "?"} days`,
              `  Deal ID: ${sessionId}`,
              ``,
              `To accept this quote, call bcp_accept_quote with dealId "${sessionId}".`,
              `To negotiate the price, call bcp_negotiate with dealId "${sessionId}" and your counter-offer.`,
            ].join("\n"),
            data: { deal, quote: response },
          };
        } catch (err) {
          return {
            error: `Could not reach seller at ${sellerUrl}: ${err}`,
          };
        }
      },
    );

    // 2 ── Negotiate ──────────────────────────────────────────────────────

    ctx.tools.register(
      TOOL_NAMES.negotiate,
      {
        displayName: "Negotiate Price",
        description:
          "Counter-offer on an existing quote. The seller will respond with an updated price or reject.",
        parametersSchema: {
          type: "object",
          properties: {
            dealId: {
              type: "string",
              description: "Deal ID from a previous quote",
            },
            counterPrice: {
              type: "number",
              description: "Your proposed price in the deal currency",
            },
            reason: {
              type: "string",
              description: "Brief reason for the counter-offer (optional)",
            },
          },
          required: ["dealId", "counterPrice"],
        },
      },
      async (params) => {
        const { dealId, counterPrice, reason } = params as {
          dealId: string;
          counterPrice: number;
          reason?: string;
        };

        const deal = await getDeal(dealId);
        if (!deal) return { error: `Deal "${dealId}" not found.` };
        if (deal.role !== "buyer")
          return { error: "You can only negotiate deals where you are the buyer." };
        if (deal.status !== "quoted" && deal.status !== "negotiating")
          return {
            error: `Deal is "${deal.status}" — can only negotiate quoted or negotiating deals.`,
          };

        const counter: BcpMessage = {
          type: "counter",
          sessionId: dealId,
          payload: {
            counterPrice,
            reason: reason ?? "",
            previousPrice: deal.price,
          },
        };

        try {
          const response = await sendBcp(deal.counterpartyUrl, counter);

          if (response.type === "quote") {
            deal.status = "negotiating";
            deal.price = response.payload.price as number;
            deal.deliverables =
              (response.payload.deliverables as string[]) ?? deal.deliverables;
            deal.estimatedDays =
              (response.payload.estimatedDays as number) ??
              deal.estimatedDays;
            deal.counterHistory = deal.counterHistory ?? [];
            deal.counterHistory.push({
              price: counterPrice,
              by: "buyer",
              at: new Date().toISOString(),
            });
            deal.counterHistory.push({
              price: deal.price,
              by: "seller",
              at: new Date().toISOString(),
            });
            await saveDeal(deal);

            return {
              content: [
                `Seller responded with updated quote:`,
                ``,
                `  New price: $${deal.price} ${deal.currency}`,
                `  Deliverables: ${(deal.deliverables ?? []).join(", ")}`,
                ``,
                `To accept, call bcp_accept_quote with dealId "${dealId}".`,
                `To negotiate further, call bcp_negotiate again.`,
              ].join("\n"),
              data: { deal, response },
            };
          }

          deal.status = "rejected";
          await saveDeal(deal);
          return {
            content: `Seller rejected the counter-offer. Deal "${dealId}" is closed.`,
          };
        } catch (err) {
          return { error: `Negotiation failed: ${err}` };
        }
      },
    );

    // 3 ── Accept Quote ───────────────────────────────────────────────────

    ctx.tools.register(
      TOOL_NAMES.acceptQuote,
      {
        displayName: "Accept Quote & Hire",
        description:
          "Accept a quoted price and hire the other company. This commits to the deal.",
        parametersSchema: {
          type: "object",
          properties: {
            dealId: {
              type: "string",
              description: "Deal ID to accept",
            },
          },
          required: ["dealId"],
        },
      },
      async (params) => {
        const { dealId } = params as { dealId: string };
        const deal = await getDeal(dealId);
        const config = await getConfig();

        if (!deal) return { error: `Deal "${dealId}" not found.` };
        if (deal.role !== "buyer")
          return { error: "You can only accept deals where you are the buyer." };
        if (deal.status !== "quoted" && deal.status !== "negotiating")
          return {
            error: `Deal is "${deal.status}" — can only accept quoted or negotiating deals.`,
          };
        if (deal.price != null && deal.price > config.maxAutoApprove) {
          return {
            error:
              `Price $${deal.price} exceeds auto-approve limit of $${config.maxAutoApprove}. ` +
              `Increase the limit in plugin settings or get human approval.`,
          };
        }

        const commit: BcpMessage = {
          type: "commit",
          sessionId: dealId,
          payload: { agreedPrice: deal.price, currency: deal.currency },
        };

        try {
          const response = await sendBcp(deal.counterpartyUrl, commit);
          deal.status = "committed";
          await saveDeal(deal);

          return {
            content: [
              `Deal committed! You've hired the company.`,
              ``,
              `  Service: ${deal.service}`,
              `  Agreed price: $${deal.price} ${deal.currency}`,
              `  Expected delivery: ${deal.estimatedDays ?? "?"} days`,
              `  Deal ID: ${dealId}`,
              ``,
              `The seller is now working on your request.`,
              `Use bcp_check_delivery with dealId "${dealId}" to check progress.`,
            ].join("\n"),
            data: { deal, response },
          };
        } catch (err) {
          return { error: `Failed to commit deal: ${err}` };
        }
      },
    );

    // 4 ── Check Delivery ─────────────────────────────────────────────────

    ctx.tools.register(
      TOOL_NAMES.checkDelivery,
      {
        displayName: "Check Delivery Status",
        description:
          "Check if a committed deal has been fulfilled. Returns deliverables if complete.",
        parametersSchema: {
          type: "object",
          properties: {
            dealId: {
              type: "string",
              description: "Deal ID to check",
            },
          },
          required: ["dealId"],
        },
      },
      async (params) => {
        const { dealId } = params as { dealId: string };
        const deal = await getDeal(dealId);
        if (!deal) return { error: `Deal "${dealId}" not found.` };

        if (deal.status === "fulfilled") {
          return {
            content: [
              `Deal "${dealId}" was already fulfilled on ${deal.fulfilledAt}.`,
              `Deliverables: ${(deal.deliverables ?? []).join(", ")}`,
            ].join("\n"),
            data: { deal },
          };
        }

        const check: BcpMessage = {
          type: "check_status",
          sessionId: dealId,
          payload: {},
        };

        try {
          const response = await sendBcp(deal.counterpartyUrl, check);

          if (response.type === "fulfil") {
            deal.status = "fulfilled";
            deal.fulfilledAt = new Date().toISOString();
            deal.deliverables =
              (response.payload.deliverables as string[]) ?? deal.deliverables;
            await saveDeal(deal);

            return {
              content: [
                `Deal fulfilled!`,
                ``,
                `  Service: ${deal.service}`,
                `  Deliverables: ${(deal.deliverables ?? []).join(", ")}`,
                response.payload.summary
                  ? `  Summary: ${response.payload.summary}`
                  : "",
                ``,
                `If there are issues, call bcp_dispute with dealId "${dealId}".`,
              ]
                .filter(Boolean)
                .join("\n"),
              data: { deal, response },
            };
          }

          return {
            content: [
              `Deal "${dealId}" is still in progress.`,
              `  Status: ${response.payload.status ?? deal.status}`,
              response.payload.progress
                ? `  Progress: ${response.payload.progress}%`
                : "",
              response.payload.note
                ? `  Note: ${response.payload.note}`
                : "",
            ]
              .filter(Boolean)
              .join("\n"),
            data: { deal, response },
          };
        } catch (err) {
          return { error: `Could not check delivery status: ${err}` };
        }
      },
    );

    // 5 ── Dispute ────────────────────────────────────────────────────────

    ctx.tools.register(
      TOOL_NAMES.dispute,
      {
        displayName: "Dispute Deal",
        description:
          "Flag a problem with a deal — wrong deliverables, poor quality, or non-delivery.",
        parametersSchema: {
          type: "object",
          properties: {
            dealId: {
              type: "string",
              description: "Deal ID to dispute",
            },
            reason: {
              type: "string",
              description: "What went wrong",
            },
          },
          required: ["dealId", "reason"],
        },
      },
      async (params) => {
        const { dealId, reason } = params as {
          dealId: string;
          reason: string;
        };
        const deal = await getDeal(dealId);
        if (!deal) return { error: `Deal "${dealId}" not found.` };
        if (deal.status !== "committed" && deal.status !== "fulfilled")
          return {
            error: `Can only dispute committed or fulfilled deals. Status: "${deal.status}".`,
          };

        const dispute: BcpMessage = {
          type: "dispute",
          sessionId: dealId,
          payload: { reason, previousStatus: deal.status },
        };

        try {
          await sendBcp(deal.counterpartyUrl, dispute);
        } catch {
          // Still record locally even if notification fails
        }

        deal.status = "disputed";
        await saveDeal(deal);

        return {
          content: `Dispute filed for deal "${dealId}". Reason: ${reason}. The seller has been notified.`,
          data: { deal },
        };
      },
    );

    // 6 ── List Deals ─────────────────────────────────────────────────────

    ctx.tools.register(
      TOOL_NAMES.listDeals,
      {
        displayName: "List All Deals",
        description:
          "Show all commerce deals — active and past. Optionally filter by status.",
        parametersSchema: {
          type: "object",
          properties: {
            status: {
              type: "string",
              description:
                "Filter by status: quoted, negotiating, committed, fulfilled, disputed",
            },
          },
        },
      },
      async (params) => {
        const { status: filterStatus } = (params ?? {}) as {
          status?: string;
        };

        const idx =
          ((await ctx.state.get({
            scopeKind: "instance",
            stateKey: "deals:index",
          })) as string[]) ?? [];

        if (idx.length === 0) {
          return {
            content:
              "No deals yet. Use bcp_request_quote to start commerce with another company.",
          };
        }

        const deals: Deal[] = [];
        for (const sid of idx) {
          const d = await getDeal(sid);
          if (d && (!filterStatus || d.status === filterStatus)) {
            deals.push(d);
          }
        }

        if (deals.length === 0) {
          return {
            content: filterStatus
              ? `No deals with status "${filterStatus}".`
              : "No deals found.",
          };
        }

        const lines = deals.map(
          (d) =>
            `  [${d.status.toUpperCase()}] ${d.sessionId} — ${d.service} — $${d.price ?? "?"} ${d.currency} (${d.role})`,
        );

        return {
          content: [`Deals (${deals.length}):`, "", ...lines].join("\n"),
          data: { deals },
        };
      },
    );

    // ═══════════════════════════════════════════════════════════════════════
    //  SELLER TOOLS
    // ═══════════════════════════════════════════════════════════════════════

    // 7 ── Mark Fulfilled ─────────────────────────────────────────────────

    ctx.tools.register(
      TOOL_NAMES.markFulfilled,
      {
        displayName: "Mark Deal as Fulfilled",
        description:
          "Mark a deal where you are the seller as fulfilled. " +
          "Use this after the work is complete and deliverables are ready.",
        parametersSchema: {
          type: "object",
          properties: {
            dealId: {
              type: "string",
              description: "Deal ID to mark as fulfilled",
            },
            summary: {
              type: "string",
              description: "Summary of what was delivered",
            },
            deliverables: {
              type: "array",
              items: { type: "string" },
              description: "List of deliverables produced",
            },
          },
          required: ["dealId"],
        },
      },
      async (params) => {
        const { dealId, summary, deliverables } = params as {
          dealId: string;
          summary?: string;
          deliverables?: string[];
        };
        const deal = await getDeal(dealId);
        if (!deal) return { error: `Deal "${dealId}" not found.` };
        if (deal.role !== "seller")
          return {
            error: `This tool is for sellers. You are the ${deal.role} in this deal.`,
          };
        if (deal.status !== "committed")
          return {
            error: `Deal must be committed to fulfill. Current status: "${deal.status}".`,
          };

        deal.status = "fulfilled";
        deal.fulfilledAt = new Date().toISOString();
        if (deliverables) deal.deliverables = deliverables;
        await saveDeal(deal);

        return {
          content: [
            `Deal "${dealId}" marked as fulfilled.`,
            summary ? `Summary: ${summary}` : "",
            `The buyer can now check delivery and confirm.`,
          ]
            .filter(Boolean)
            .join("\n"),
          data: { deal },
        };
      },
    );

    ctx.logger.info(`${PLUGIN_NAME} ready — 7 tools registered`);
  },

  // ═══════════════════════════════════════════════════════════════════════
  //  SELLER WEBHOOK — receives BCP messages from other companies
  //  Route: POST /api/plugins/bcp-commerce/webhooks/bcp-incoming
  // ═══════════════════════════════════════════════════════════════════════

  async onWebhook(input: PluginWebhookInput) {
    if (input.endpointKey !== WEBHOOK_KEYS.bcpIncoming) return;

    let msg: BcpMessage;
    try {
      msg = (input.parsedBody ?? JSON.parse(input.rawBody)) as BcpMessage;
    } catch {
      _ctx.logger.warn("Invalid JSON in webhook body");
      return;
    }

    if (!msg?.type || !msg?.sessionId) {
      _ctx.logger.warn("Invalid BCP message — missing type or sessionId");
      return;
    }

    const config = await getConfig();
    _ctx.logger.info(`BCP incoming: ${msg.type} session=${msg.sessionId}`);

    const callbackUrl = msg.payload.callbackUrl as string | undefined;

    switch (msg.type) {
      // ── INTENT → auto-generate QUOTE and store deal ────────────────
      case "intent": {
        const service = msg.payload.service as string;
        const matched = matchService(service, config.services);

        if (!matched) {
          _ctx.logger.info(`No matching service for "${service}"`);
          if (callbackUrl) {
            await _ctx.http.fetch(callbackUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                type: "reject",
                sessionId: msg.sessionId,
                payload: { reason: "No matching service available" },
              }),
            }).catch(() => {});
          }
          return;
        }

        const quote: BcpMessage = {
          type: "quote",
          sessionId: msg.sessionId,
          payload: {
            price: matched.basePrice,
            currency: matched.currency ?? config.currency,
            deliverables: matched.deliverables ?? [matched.name],
            estimatedDays: matched.estimatedDays ?? 7,
            serviceName: matched.name,
          },
        };

        const deal: Deal = {
          sessionId: msg.sessionId,
          role: "seller",
          status: "quoted",
          service,
          counterpartyUrl: callbackUrl ?? "",
          price: matched.basePrice,
          currency: matched.currency ?? config.currency,
          deliverables: matched.deliverables ?? [matched.name],
          estimatedDays: matched.estimatedDays ?? 7,
          counterHistory: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        await saveDeal(deal);
        await addDealToIndex(msg.sessionId);

        _ctx.logger.info(
          `Quoted $${matched.basePrice} for "${service}" → session ${msg.sessionId}`,
        );

        if (callbackUrl) {
          await _ctx.http.fetch(callbackUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(quote),
          }).catch(() => {});
        }
        return;
      }

      // ── COUNTER → negotiate (meet in the middle) ───────────────────
      case "counter": {
        const deal = await getDeal(msg.sessionId);
        if (!deal) return;

        const counterPrice = msg.payload.counterPrice as number;
        const currentPrice = deal.price ?? 0;
        const newPrice = Math.round((currentPrice + counterPrice) / 2);

        deal.status = "negotiating";
        deal.price = newPrice;
        deal.counterHistory = deal.counterHistory ?? [];
        deal.counterHistory.push({
          price: counterPrice,
          by: "buyer",
          at: new Date().toISOString(),
        });
        deal.counterHistory.push({
          price: newPrice,
          by: "seller",
          at: new Date().toISOString(),
        });
        await saveDeal(deal);

        _ctx.logger.info(
          `Counter: buyer offered $${counterPrice}, responded $${newPrice} → session ${msg.sessionId}`,
        );

        if (callbackUrl ?? deal.counterpartyUrl) {
          await _ctx.http.fetch((callbackUrl ?? deal.counterpartyUrl)!, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: "quote",
              sessionId: msg.sessionId,
              payload: {
                price: newPrice,
                currency: deal.currency,
                deliverables: deal.deliverables,
                estimatedDays: deal.estimatedDays,
              },
            }),
          }).catch(() => {});
        }
        return;
      }

      // ── COMMIT → accept the deal ───────────────────────────────────
      case "commit": {
        const deal = await getDeal(msg.sessionId);
        if (!deal) return;

        deal.status = "committed";
        await saveDeal(deal);

        _ctx.logger.info(
          `Deal committed: "${deal.service}" for $${deal.price} → session ${msg.sessionId}`,
        );
        return;
      }

      // ── CHECK STATUS → send current state back via callback ────────
      case "check_status": {
        const deal = await getDeal(msg.sessionId);
        if (!deal) return;

        const responseUrl = callbackUrl ?? deal.counterpartyUrl;
        if (!responseUrl) return;

        const body =
          deal.status === "fulfilled"
            ? {
                type: "fulfil",
                sessionId: msg.sessionId,
                payload: {
                  deliverables: deal.deliverables,
                  summary: `Completed: ${deal.service}`,
                },
              }
            : {
                type: "status",
                sessionId: msg.sessionId,
                payload: { status: deal.status },
              };

        await _ctx.http.fetch(responseUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }).catch(() => {});
        return;
      }

      // ── DISPUTE → record dispute ───────────────────────────────────
      case "dispute": {
        const deal = await getDeal(msg.sessionId);
        if (!deal) return;

        deal.status = "disputed";
        await saveDeal(deal);
        _ctx.logger.warn(
          `Dispute on session ${msg.sessionId}: ${msg.payload.reason}`,
        );
        return;
      }

      default:
        _ctx.logger.warn(`Unknown BCP message type: ${msg.type}`);
    }
  },

  async onHealth() {
    return { status: "ok", message: "BCP Commerce plugin running" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
