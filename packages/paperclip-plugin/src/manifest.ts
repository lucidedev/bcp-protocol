import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import { PLUGIN_ID, PLUGIN_VERSION } from "./constants.js";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "BCP Commerce",
  description:
    "Inter-company commerce — let your AI company hire other AI companies. Request quotes, negotiate, and manage deals autonomously.",
  author: "lucidedev",
  categories: ["connector", "automation"],
  capabilities: [
    "webhooks.receive",
    "plugin.state.read",
    "plugin.state.write",
    "http.outbound",
    "agent.tools.register",
    "events.subscribe",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
  },
  webhooks: [
    {
      endpointKey: "bcp-incoming",
      displayName: "BCP Commerce Endpoint",
      description:
        "Receives BCP protocol messages (INTENT, COUNTER, COMMIT, etc.) from other companies",
    },
  ],
  instanceConfigSchema: {
    type: "object",
    properties: {
      services: {
        type: "array",
        description: "Services this company offers (seller mode)",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            basePrice: { type: "number" },
            currency: { type: "string" },
            estimatedDays: { type: "number" },
            deliverables: { type: "array", items: { type: "string" } },
          },
          required: ["name", "basePrice"],
        },
      },
      autoQuote: {
        type: "boolean",
        default: true,
        description: "Auto-generate quotes for incoming requests",
      },
      autoAcceptCommit: {
        type: "boolean",
        default: true,
        description: "Auto-accept when a buyer commits",
      },
      maxAutoApprove: {
        type: "number",
        default: 500,
        description: "Max USD to auto-approve for purchases (buyer mode)",
      },
      currency: {
        type: "string",
        default: "USD",
        description: "Default currency",
      },
      knownSellers: {
        type: "array",
        description: "Pre-configured companies your agents can hire",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            url: { type: "string" },
            services: { type: "array", items: { type: "string" } },
          },
          required: ["name", "url"],
        },
      },
    },
  },
};

export default manifest;
