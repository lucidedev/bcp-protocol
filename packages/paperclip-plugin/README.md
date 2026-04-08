# paperclip-plugin-bcp-commerce

**Inter-company commerce for Paperclip.** Let your AI company hire other AI companies — request quotes, negotiate prices, and manage deals autonomously.

## Install

```bash
paperclipai plugin install paperclip-plugin-bcp-commerce
```

## What it does

Adds 7 commerce tools to your Paperclip agents:

| Tool | Description |
|------|-------------|
| `bcp_request_quote` | Request a quote from another company |
| `bcp_negotiate` | Counter-offer on a quote |
| `bcp_accept_quote` | Accept a quote and hire the company |
| `bcp_check_delivery` | Check if hired work is complete |
| `bcp_mark_fulfilled` | Mark your work as delivered (seller) |
| `bcp_dispute` | Flag problems with a deal |
| `bcp_list_deals` | List all active and past deals |

Both sides of the deal use the same plugin — buyers get purchasing tools, sellers get a webhook that auto-quotes incoming requests.

## Example

Your CEO agent says: *"We need a logo designed. Find a design company and hire them."*

The agent:
1. Calls `bcp_request_quote` → gets a $450 quote from DesignCo
2. Calls `bcp_negotiate` → counter-offers at $350
3. DesignCo auto-responds with $400
4. Calls `bcp_accept_quote` → deal committed
5. DesignCo's agents do the work, call `bcp_mark_fulfilled`
6. Calls `bcp_check_delivery` → gets deliverables

All autonomous. No human in the loop.

## Configuration

### As a buyer

Set your auto-approve spending limit and known sellers:

```json
{
  "maxAutoApprove": 1000,
  "knownSellers": [
    {
      "name": "DesignCo",
      "url": "https://designco.example.com/api/plugins/bcp-commerce/webhooks/bcp-incoming",
      "services": ["Logo Design", "Brand Identity"]
    }
  ]
}
```

### As a seller

Configure what services your company offers. The plugin auto-generates quotes for incoming requests:

```json
{
  "services": [
    {
      "name": "Logo Design",
      "basePrice": 500,
      "estimatedDays": 5,
      "deliverables": ["3 logo concepts", "brand guidelines PDF", "source files"]
    },
    {
      "name": "Landing Page",
      "basePrice": 1500,
      "estimatedDays": 10,
      "deliverables": ["responsive landing page", "source code", "deployment"]
    }
  ]
}
```

Negotiation is automatic — the plugin meets counter-offers in the middle.

## How it works

Under the hood, this plugin uses the [BCP Protocol](https://github.com/lucidedev/bcp-protocol) (Business Commerce Protocol) — an open standard for autonomous AI agent commerce with negotiation, escrow, and settlement.

The protocol flow: **INTENT → QUOTE → (COUNTER →)* COMMIT → FULFIL**

Each step is a signed HTTP message between two Paperclip instances. No central server, no middleman.

## License

MIT
