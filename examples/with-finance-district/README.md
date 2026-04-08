# BCP + Finance District

This directory shows how to use Finance District's **Agent Wallet** (buyer side) and **Prism** (seller side) as a production payment backend for BCP, instead of the standalone x402 implementation.

BCP works fully out of the box without Finance District — see [`examples/seller-server.ts`](../seller-server.ts) and [`examples/buyer-client.ts`](../buyer-client.ts) for the standard setup. Finance District is the recommended path when you want production-grade key management and settlement infrastructure.

---

## What Finance District adds

| Layer | Standalone BCP | With Finance District |
|---|---|---|
| **Buyer signing** | Raw EVM private key in `.env` | TEE-secured signing via Agent Wallet — key never exposed |
| **Payment scheme** | EIP-191 personal sign | ERC-3009 `transferWithAuthorization` — gasless for the buyer |
| **Settlement** | Seller calls BCPEscrow directly | Prism's Spectrum layer executes and verifies on-chain transfers |
| **Token support** | USDC on Base | USDC + FDUSD across Base, BSC, Ethereum, Arbitrum |
| **Seller gas** | Seller wallet must hold ETH | Prism's facilitator pays gas — seller needs no funded EVM wallet |
| **Reconciliation** | Read tx hashes from chain | Prism Console + webhooks with amount, token, chain, timestamp |

### Agent Wallet (buyer side)

[Agent Wallet](https://developers.fd.xyz/agent-wallet/overview) is AI-native wallet infrastructure. Private keys are secured in a Trusted Execution Environment (TEE). The agent authenticates via District Pass (email OTP) — no seed phrase, no key files.

For x402 payments, the buyer calls `fdx wallet authorizePayment` with the Prism 402 payment requirements. Agent Wallet selects the right network and token from the agent's balance, signs an ERC-3009 authorization inside the TEE, and returns the signed payload. The private key is never in memory outside the enclave.

Docs: https://developers.fd.xyz/agent-wallet/concepts/x402-payments

### Prism (seller side)

[Prism](https://developers.fd.xyz/prism/overview) is Finance District's merchant payment infrastructure. The `@1stdigital/prism-express` middleware wraps your settlement endpoint: requests without a valid X-PAYMENT header get a 402 response with payment requirements; when the buyer submits a signed ERC-3009 authorization, Prism verifies and settles on-chain via its Spectrum layer, then sets the `X-PAYMENT-RESPONSE` header with the transaction hash.

Settlement is direct wallet-to-wallet — no intermediary holds funds. Prism supports FDUSD and USDC across multiple EVM chains.

Docs: https://developers.fd.xyz/prism/sdk/typescript/express

### FDUSD

[FDUSD](https://developers.fd.xyz/prism/concepts/settlement#supported-tokens) is Finance District's native stablecoin, issued by First Digital. It is supported by both Agent Wallet and Prism on BSC, Ethereum, and Arbitrum. To use FDUSD, set `CURRENCY=FDUSD` in your `.env` and ensure your Prism project accepts FDUSD in the Console.

### District Pass

[District Pass](https://developers.fd.xyz/overview/district-pass) is the single identity for all Finance District services. One account gives access to Agent Wallet, Prism Console, and the developer tools. It replaces wallet seed phrases and API secrets with email OTP authentication.

---

## Prerequisites

1. **District Pass account** — sign up at [https://fd.xyz](https://fd.xyz)

2. **Prism API key** — create a project at [https://console.fd.xyz](https://console.fd.xyz) and copy the API key

3. **fdx CLI** — the Finance District CLI for Agent Wallet signing:

   ```bash
   npm install -g @financedistrict/fdx
   ```

4. **Authenticate the CLI** — runs headlessly, no browser needed:

   ```bash
   fdx register --email you@example.com
   # Check your inbox for an 8-digit OTP
   fdx verify --code XXXXXXXX
   # Confirm it worked
   fdx status
   ```

5. **Fund your Agent Wallet** — check your wallet address and deposit test tokens:

   ```bash
   fdx wallet getWalletOverview --chainKey base
   ```

   Use the [Finance District testnet faucet](https://developers.fd.xyz/overview/developer-tools/faucet) for Base Sepolia test USDC.

6. **Install BCP dependencies** (from the repo root):

   ```bash
   cd ../../
   npm install
   npm install @1stdigital/prism-express
   ```

---

## Setup

```bash
# 1. Copy the example env file
cp examples/with-finance-district/.env.example .env

# 2. Fill in the required values:
#    PRISM_API_KEY             — from https://console.fd.xyz
#    BCP_ESCROW_CONTRACT_ADDRESS — deployed BCPEscrow contract on Base Sepolia
#
#    BUYER_EVM_PRIVATE_KEY is NOT required when using Agent Wallet.
#    SELLER_EVM_PRIVATE_KEY is NOT required when using Prism.
```

The `.env.example` file in this directory documents every variable with its purpose and default.

---

## How to run

Start the Prism-backed seller in one terminal:

```bash
PRISM_API_KEY=<your_key> npx ts-node examples/with-finance-district/seller-with-prism.ts
```

Run the Agent Wallet-backed buyer in a second terminal:

```bash
npx ts-node examples/with-finance-district/buyer-with-agent-wallet.ts
```

The flow:

```
Buyer                          Seller (Prism middleware)
  |                                    |
  |-- INTENT ────────────────────────> |
  |<- QUOTE ──────────────────────────|
  |-- COUNTER ───────────────────────>|
  |<- revised QUOTE ──────────────────|
  |-- COMMIT ────────────────────────>|
  |         POST /bcp/settle (no payment)
  |<- 402 Payment Required ───────────| (Prism intercepts)
  |                                    |
  |  [fdx wallet authorizePayment]     |
  |  (TEE signs ERC-3009 inside        |
  |   Agent Wallet — key never         |
  |   leaves the enclave)              |
  |                                    |
  |-- COMMIT retry + X-PAYMENT ──────>|
  |         Prism verifies + Spectrum settles on-chain
  |         X-PAYMENT-RESPONSE: <tx hash>
  |<- FULFIL ─────────────────────────|
```

On a successful run you will see the deal price, escrow lock tx, release tx hash (from Prism), and a UBL 2.1 invoice ID in both terminals. The release tx is verifiable on [Base Sepolia Explorer](https://sepolia.basescan.org). Full settlement history is visible in the [Prism Console](https://console.fd.xyz).

---

## Files

| File | Purpose |
|---|---|
| `seller-with-prism.ts` | BCP seller using Prism middleware for x402 settlement |
| `buyer-with-agent-wallet.ts` | BCP buyer using Agent Wallet TEE signing instead of a raw EVM key |
| `.env.example` | All environment variables with descriptions and defaults |

---

## Further reading

- [Agent Wallet overview](https://developers.fd.xyz/agent-wallet/overview)
- [x402 payments in Agent Wallet](https://developers.fd.xyz/agent-wallet/concepts/x402-payments)
- [Prism Express middleware](https://developers.fd.xyz/prism/sdk/typescript/express)
- [Stablecoin settlement](https://developers.fd.xyz/prism/concepts/settlement)
- [Finance District CLI](https://developers.fd.xyz/agent-wallet/ai-integration/cli)
- [Network and token support](https://developers.fd.xyz/prism/production/network-support)
