#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# demo-two-companies.sh
#
# BCP + Paperclip demo: two autonomous companies trading with each other.
#
# This script starts both Paperclip HTTP adapters (buyer and seller) and
# then prints step-by-step instructions for wiring them up in Paperclip.
#
# Paperclip gives AI agents a company.
# BCP gives those companies the ability to trade with each other.
#
# Prerequisites:
#   1. Node.js 20+ and ts-node installed
#   2. npx paperclipai onboard --yes  (run once)
#   3. .env.buyer and .env.seller configured (see README.md)
#   4. BCPEscrow contract deployed on Base Sepolia
#
# Usage:
#   bash examples/with-paperclip/demo-two-companies.sh
# ─────────────────────────────────────────────────────────────────────────────

set -e

# ── Resolve project root ──────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

cd "$PROJECT_ROOT"

# ── Colour helpers ────────────────────────────────────────────────────────────
BOLD='\033[1m'
DIM='\033[2m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RESET='\033[0m'

header() { echo -e "\n${BOLD}${CYAN}$*${RESET}"; }
step()   { echo -e "${BOLD}${GREEN}$*${RESET}"; }
info()   { echo -e "${DIM}$*${RESET}"; }
warn()   { echo -e "${YELLOW}$*${RESET}"; }

# ── Check prerequisites ───────────────────────────────────────────────────────
header "Checking prerequisites..."

if ! command -v node >/dev/null 2>&1; then
  warn "Node.js not found. Install Node.js 20+ from https://nodejs.org"
  exit 1
fi

NODE_VERSION=$(node --version | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  warn "Node.js 20+ required. Found: $(node --version)"
  exit 1
fi
info "  Node.js: $(node --version)"

if ! command -v npx >/dev/null 2>&1; then
  warn "npx not found. Install npm or update Node.js."
  exit 1
fi
info "  npx: $(npx --version)"

# Check for ts-node
if ! npx ts-node --version >/dev/null 2>&1; then
  warn "ts-node not found. Run: npm install"
  exit 1
fi
info "  ts-node: $(npx ts-node --version)"

# Check environment files
if [ ! -f ".env.buyer" ] && [ ! -f ".env" ]; then
  warn ""
  warn "  No .env.buyer file found."
  warn "  Copy .env.example to .env.buyer and fill in wallet keys."
  warn "  See examples/with-paperclip/README.md for details."
  warn ""
  # Non-fatal — allow continuing so adapters can start and show their own error
fi

if [ ! -f ".env.seller" ] && [ ! -f ".env" ]; then
  warn "  No .env.seller file found."
  warn "  Copy .env.example to .env.seller and fill in wallet keys."
fi

# ── Cleanup on exit ───────────────────────────────────────────────────────────
SELLER_PID=""
BUYER_PID=""

cleanup() {
  echo ""
  header "Shutting down..."
  if [ -n "$SELLER_PID" ] && kill -0 "$SELLER_PID" 2>/dev/null; then
    info "  Stopping DataSeller Co adapter (PID: $SELLER_PID)..."
    kill "$SELLER_PID" 2>/dev/null || true
  fi
  if [ -n "$BUYER_PID" ] && kill -0 "$BUYER_PID" 2>/dev/null; then
    info "  Stopping BuyerCorp adapter (PID: $BUYER_PID)..."
    kill "$BUYER_PID" 2>/dev/null || true
  fi
  echo -e "${DIM}Demo stopped.${RESET}"
}

trap cleanup EXIT INT TERM

# ── Step 1: Start DataSeller Co adapter ──────────────────────────────────────
header "Step 1: Starting DataSeller Co BCP adapter..."
info "  BCP seller server:      port 3002"
info "  Paperclip adapter:      port 4002"

# Use .env.seller if it exists, otherwise fall through to .env
ENV_FILE=".env"
if [ -f ".env.seller" ]; then
  ENV_FILE=".env.seller"
fi

# Start seller adapter in background, write logs to a file
SELLER_LOG="${PROJECT_ROOT}/.paperclip-seller.log"
env $(grep -v '^#' "$ENV_FILE" | xargs) \
  npx ts-node examples/with-paperclip/paperclip-seller-adapter.ts \
  > "$SELLER_LOG" 2>&1 &
SELLER_PID=$!

info "  Waiting for seller adapter to initialise..."
sleep 4

if ! kill -0 "$SELLER_PID" 2>/dev/null; then
  warn "  DataSeller Co adapter failed to start. Check logs:"
  warn "    cat ${SELLER_LOG}"
  exit 1
fi

step "  DataSeller Co adapter running (PID: ${SELLER_PID})"
info "  Logs: ${SELLER_LOG}"

# ── Step 2: Start BuyerCorp adapter ──────────────────────────────────────────
header "Step 2: Starting BuyerCorp BCP adapter..."
info "  Paperclip adapter:      port 4001"

ENV_FILE=".env"
if [ -f ".env.buyer" ]; then
  ENV_FILE=".env.buyer"
fi

BUYER_LOG="${PROJECT_ROOT}/.paperclip-buyer.log"
env $(grep -v '^#' "$ENV_FILE" | xargs) \
  npx ts-node examples/with-paperclip/paperclip-buyer-adapter.ts \
  > "$BUYER_LOG" 2>&1 &
BUYER_PID=$!

info "  Waiting for buyer adapter to initialise..."
sleep 3

if ! kill -0 "$BUYER_PID" 2>/dev/null; then
  warn "  BuyerCorp adapter failed to start. Check logs:"
  warn "    cat ${BUYER_LOG}"
  exit 1
fi

step "  BuyerCorp adapter running (PID: ${BUYER_PID})"
info "  Logs: ${BUYER_LOG}"

# ── Step 3: Health checks ─────────────────────────────────────────────────────
header "Step 3: Verifying adapters are healthy..."

# Give them a moment to bind their ports
sleep 2

if curl -s -f http://localhost:4002/health >/dev/null 2>&1; then
  step "  DataSeller Co adapter: healthy (http://localhost:4002/health)"
else
  warn "  DataSeller Co adapter health check failed — may still be starting."
fi

if curl -s -f http://localhost:4001/health >/dev/null 2>&1; then
  step "  BuyerCorp adapter:     healthy (http://localhost:4001/health)"
else
  warn "  BuyerCorp adapter health check failed — may still be starting."
fi

# ── Step 4: Print Paperclip instructions ─────────────────────────────────────
echo ""
echo -e "${BOLD}────────────────────────────────────────────────────────────────${RESET}"
header "Step 4: Set up your Paperclip companies"
echo -e "${BOLD}────────────────────────────────────────────────────────────────${RESET}"
echo ""
echo -e "${BOLD}Create two companies in the Paperclip dashboard:${RESET}"
echo ""

echo -e "${BOLD}Company 1 — DataSeller Co (the seller)${RESET}"
echo -e "  ${DIM}Add a sales agent with:${RESET}"
echo -e "  ${YELLOW}HTTP adapter URL:${RESET} http://localhost:4002/heartbeat"
echo -e "  ${YELLOW}Skill file:${RESET}       examples/with-paperclip/bcp-seller-skill.md"
echo ""
echo -e "  ${DIM}Assign this task to the sales agent:${RESET}"
echo -e "  ${CYAN}\"Start accepting purchase orders for market research reports."
echo -e "  Use 15% markup. Auto-accept counter-offers. Notify me of each deal.\"${RESET}"
echo ""

echo -e "${BOLD}Company 2 — BuyerCorp (the buyer)${RESET}"
echo -e "  ${DIM}Add a procurement agent with:${RESET}"
echo -e "  ${YELLOW}HTTP adapter URL:${RESET} http://localhost:4001/heartbeat"
echo -e "  ${YELLOW}Skill file:${RESET}       examples/with-paperclip/bcp-buyer-skill.md"
echo ""
echo -e "  ${DIM}Assign this task to the procurement agent:${RESET}"
echo -e "  ${CYAN}\"Purchase a market research report on AI agent commerce from"
echo -e "  DataSeller Co (http://localhost:3002). Budget: \$10 USDC.\"${RESET}"
echo ""

echo -e "${BOLD}────────────────────────────────────────────────────────────────${RESET}"
header "What to expect"
echo -e "${BOLD}────────────────────────────────────────────────────────────────${RESET}"
echo ""
echo -e "When Paperclip sends the task to BuyerCorp's heartbeat endpoint:"
echo ""
echo -e "  ${DIM}1.${RESET} Buyer adapter parses the task and calls BCPBuyer.purchase()"
echo -e "  ${DIM}2.${RESET} INTENT sent to DataSeller Co's BCP server (port 3002)"
echo -e "  ${DIM}3.${RESET} DataSeller Co returns a QUOTE with 15% markup (~\$11.50)"
echo -e "  ${DIM}4.${RESET} Buyer sends COMMIT and locks USDC in BCPEscrow on Base"
echo -e "  ${DIM}5.${RESET} DataSeller Co confirms delivery and releases escrow"
echo -e "  ${DIM}6.${RESET} Buyer adapter returns deal result to Paperclip"
echo ""
echo -e "${BOLD}Verify on-chain:${RESET}"
echo -e "  https://sepolia.basescan.org — search for your wallet address"
echo ""
echo -e "${BOLD}Watch the live logs:${RESET}"
echo -e "  ${DIM}Seller:${RESET}  tail -f ${SELLER_LOG}"
echo -e "  ${DIM}Buyer:${RESET}   tail -f ${BUYER_LOG}"
echo ""
echo -e "${BOLD}────────────────────────────────────────────────────────────────${RESET}"
echo ""
warn "Both adapters are running. Press Ctrl+C to stop."
echo ""

# ── Keep running until interrupted ───────────────────────────────────────────
# Tee live logs to stdout so the demo user can see activity
echo -e "${DIM}--- Live logs (seller | buyer) ---${RESET}"
tail -f "$SELLER_LOG" "$BUYER_LOG" 2>/dev/null &
TAIL_PID=$!

# Wait for either adapter to die
wait "$SELLER_PID" "$BUYER_PID" 2>/dev/null || true
kill "$TAIL_PID" 2>/dev/null || true
