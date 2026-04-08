export const PLUGIN_ID = "bcp-commerce";
export const PLUGIN_VERSION = "0.1.0";
export const PLUGIN_NAME = "BCP Commerce";

export const TOOL_NAMES = {
  requestQuote: "bcp_request_quote",
  negotiate: "bcp_negotiate",
  acceptQuote: "bcp_accept_quote",
  checkDelivery: "bcp_check_delivery",
  markFulfilled: "bcp_mark_fulfilled",
  dispute: "bcp_dispute",
  listDeals: "bcp_list_deals",
} as const;

export const WEBHOOK_KEYS = {
  bcpIncoming: "bcp-incoming",
} as const;
