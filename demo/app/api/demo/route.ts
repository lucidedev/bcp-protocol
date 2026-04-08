import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';

// ── UBL 2.1 Invoice Generator ────────────────────────────────────
function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function generateUBLInvoice(opts: {
  invoiceId: string;
  buyerName: string;
  buyerWallet: string;
  sellerName: string;
  sellerWallet: string;
  escrowContract: string;
  currency: string;
  amount: number;
  lineItems: { description: string; qty: number; unit: string; unitPrice: number }[];
  txHash: string;
}): { xml: string; hash: string } {
  const today = new Date().toISOString().split('T')[0];
  const due = new Date(Date.now() + 30 * 86400_000).toISOString().split('T')[0];

  const linesXml = opts.lineItems.map((item, i) => {
    const lineTotal = item.qty * item.unitPrice;
    return `
    <cac:InvoiceLine>
      <cbc:ID>${i + 1}</cbc:ID>
      <cbc:InvoicedQuantity unitCode="${escapeXml(item.unit)}">${item.qty}</cbc:InvoicedQuantity>
      <cbc:LineExtensionAmount currencyID="${escapeXml(opts.currency)}">${lineTotal.toFixed(2)}</cbc:LineExtensionAmount>
      <cac:Item>
        <cbc:Name>${escapeXml(item.description)}</cbc:Name>
      </cac:Item>
      <cac:Price>
        <cbc:PriceAmount currencyID="${escapeXml(opts.currency)}">${item.unitPrice.toFixed(2)}</cbc:PriceAmount>
      </cac:Price>
    </cac:InvoiceLine>`;
  }).join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:ID>${escapeXml(opts.invoiceId)}</cbc:ID>
  <cbc:IssueDate>${today}</cbc:IssueDate>
  <cbc:DueDate>${due}</cbc:DueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${escapeXml(opts.currency)}</cbc:DocumentCurrencyCode>
  <cbc:BuyerReference>BCP-${escapeXml(opts.txHash.slice(0, 10))}</cbc:BuyerReference>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="ETH">${escapeXml(opts.sellerWallet)}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyName>
        <cbc:Name>${escapeXml(opts.sellerName)}</cbc:Name>
      </cac:PartyName>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="ETH">${escapeXml(opts.buyerWallet)}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyName>
        <cbc:Name>${escapeXml(opts.buyerName)}</cbc:Name>
      </cac:PartyName>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>ZZZ</cbc:PaymentMeansCode>
    <cbc:InstructionNote>BCP on-chain escrow settlement</cbc:InstructionNote>
    <cbc:PaymentID>${escapeXml(opts.escrowContract)}</cbc:PaymentID>
  </cac:PaymentMeans>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${escapeXml(opts.currency)}">${opts.amount.toFixed(2)}</cbc:LineExtensionAmount>
    <cbc:PayableAmount currencyID="${escapeXml(opts.currency)}">${opts.amount.toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>${linesXml}
</Invoice>`;

  const hash = createHash('sha256').update(xml, 'utf8').digest('hex');
  return { xml, hash };
}

// ── Config ─────────────────────────────────────────────────────────
const RPC_URL = process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org';
const USDC_ADDRESS = process.env.USDC_TOKEN_ADDRESS || '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const USDC_DECIMALS = Number(process.env.USDC_DECIMALS || '6');
const CONTRACT_ADDRESS = process.env.BCP_ESCROW_CONTRACT_ADDRESS || '';
const BUYER_KEY = process.env.BUYER_EVM_PRIVATE_KEY || '';
const SELLER_KEY = process.env.SELLER_EVM_PRIVATE_KEY || '';
const EXPLORER_URL = 'https://sepolia.basescan.org';
const DEMO_AMOUNT = 5; // 5 USDC

const ERC20_ABI = [
  'function balanceOf(address) external view returns (uint256)',
  'function approve(address,uint256) external returns (bool)',
  'function allowance(address,address) external view returns (uint256)',
  'function transfer(address,uint256) external returns (bool)',
];

const ESCROW_ABI = [
  'function lockToken(bytes32 commitId, address buyer, address seller, uint256 releaseAfter, address token, uint256 amount) external',
  'function release(bytes32 commitId) external',
  'function freeze(bytes32 commitId) external',
  'function approveUnfreeze(bytes32 commitId) external',
  'function getEscrow(bytes32 commitId) external view returns (address buyer, address seller, uint256 amount, uint256 releaseAfter, uint8 status, address token)',
  'event Unfrozen(bytes32 indexed commitId)',
];

/** Convert a UUID commit ID to a bytes32 hash for the contract */
function commitIdToBytes32(id: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(id));
}

// ── Session state persisted between step requests ──────────────────
interface Session {
  intentId: string;
  quoteId: string;
  counterId: string;
  acceptedQuoteId: string;
  commitId: string;
  commitHash: string;
  fulfilId: string;
  disputeId: string;
  invoiceId: string;
  lockTxHash: string;
  releaseTxHash: string;
  freezeTxHash: string;
  unfreezeTxHash: string;
  lockGasWei: bigint;
  releaseGasWei: bigint;
  startTime: number;
}

let session: Session | null = null;

type StepName = 'init' | 'intent' | 'quote' | 'counter' | 'accept' | 'commit' | 'dispute' | 'resolve' | 'fulfil' | 'reset';

export async function POST(req: NextRequest) {
  if (!CONTRACT_ADDRESS || !BUYER_KEY || !SELLER_KEY) {
    return NextResponse.json({ error: 'Server not configured. Set .env variables.' }, { status: 500 });
  }

  let body: { step: StepName };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const { step } = body;

  if (step !== 'init' && !session) {
    return NextResponse.json({ error: 'No active session. Start with init.' }, { status: 400 });
  }

  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const buyerWallet = new ethers.Wallet(BUYER_KEY, provider);
    const sellerWallet = new ethers.Wallet(SELLER_KEY, provider);
    const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, provider);

    const getBalances = async () => {
      const [b, s] = await Promise.all([
        usdc.balanceOf(buyerWallet.address),
        usdc.balanceOf(sellerWallet.address),
      ]);
      return {
        type: 'balance' as const,
        timestamp: Date.now(),
        buyer: ethers.formatUnits(b, USDC_DECIMALS),
        seller: ethers.formatUnits(s, USDC_DECIMALS),
      };
    };

    const events: Record<string, unknown>[] = [];
    const quotePrice = Math.round(DEMO_AMOUNT * 1.15 * 100) / 100;

    switch (step) {
      // ── INIT — fetch balances, generate IDs ────────────────────
      case 'init': {
        session = null; // reset any stuck state

        const buyerRaw = await usdc.balanceOf(buyerWallet.address);
        if (buyerRaw < ethers.parseUnits(String(DEMO_AMOUNT), USDC_DECIMALS)) {
          return NextResponse.json({
            error: `Buyer has insufficient USDC (${ethers.formatUnits(buyerRaw, USDC_DECIMALS)}). Need ${DEMO_AMOUNT}.`,
          }, { status: 400 });
        }

        session = {
          intentId: uuidv4(),
          quoteId: uuidv4(),
          counterId: uuidv4(),
          acceptedQuoteId: uuidv4(),
          commitId: uuidv4(),
          commitHash: '',
          fulfilId: uuidv4(),
          disputeId: uuidv4(),
          invoiceId: `INV-${Date.now()}`,
          lockTxHash: '',
          releaseTxHash: '',
          freezeTxHash: '',
          unfreezeTxHash: '',
          lockGasWei: 0n,
          releaseGasWei: 0n,
          startTime: Date.now(),
        };
        session.commitHash = commitIdToBytes32(session.commitId);
        events.push(await getBalances());
        break;
      }

      // ── INTENT — buyer declares need ───────────────────────────
      case 'intent': {
        events.push({
          type: 'reasoning', timestamp: Date.now(), sender: 'buyer',
          agentName: 'Velocity Procurement AI',
          thought: 'Our Q3 delivery costs rose 18% due to driver detours. The ops team flagged that 40% of planned routes hit unexpected road closures. I need a real-time route optimization API to cut fuel waste across our 520-truck fleet.',
          action: 'Broadcasting INTENT to qualified data providers via BCP protocol',
        });
        events.push({
          type: 'message', timestamp: Date.now(),
          messageType: 'INTENT', sender: 'buyer', id: session!.intentId,
          summary: 'Fleet Route Optimization API — 10,000 calls/mo',
          detailRows: [
            { label: 'Category', value: 'Real-time route optimization API' },
            { label: 'Volume', value: '10,000 API calls / month' },
            { label: 'Coverage', value: 'US lower-48 states' },
            { label: 'Data freshness', value: '< 15 min road closure updates' },
            { label: 'Budget ceiling', value: '$25.00 USDC / month' },
            { label: 'Payment terms', value: 'Immediate (escrow)' },
          ],
          detail: {
            category: 'route-optimization-api',
            quantity: 10000,
            budget_max: 25,
            currency: 'USDC',
            payment_terms: 'immediate',
            requirements: 'Real-time road closure data, < 15 min latency, US lower-48 coverage',
          },
        });
        break;
      }

      // ── QUOTE — seller responds ────────────────────────────────
      case 'quote': {
        events.push({
          type: 'reasoning', timestamp: Date.now(), sender: 'seller',
          agentName: 'Meridian Sales AI',
          thought: `Incoming INTENT from Velocity Logistics — a Series C freight company with 520 trucks. They need route optimization at scale. Our standard rate is $0.65/1K calls, but their volume qualifies for Tier 2 pricing. I'll quote $${quotePrice} for 10K calls with our Premium data feed which includes DOT road closure integration.`,
          action: 'Generating QUOTE with Tier 2 volume pricing',
        });
        events.push({
          type: 'message', timestamp: Date.now(),
          messageType: 'QUOTE', sender: 'seller', id: session!.quoteId,
          summary: `$${quotePrice} USDC — Premium Route API`,
          detailRows: [
            { label: 'Product', value: 'RouteIQ Premium API (10K calls)' },
            { label: 'Unit price', value: `$${(quotePrice / 10).toFixed(4)} / 1K calls` },
            { label: 'Total', value: `$${quotePrice} USDC` },
            { label: 'Data sources', value: 'DOT feeds, Waze, municipal closures' },
            { label: 'Latency SLA', value: '< 12 min average update' },
            { label: 'Payment', value: 'Immediate (escrow-backed)' },
            { label: 'Valid for', value: '24 hours' },
          ],
          detail: {
            price: quotePrice,
            currency: 'USDC',
            payment_terms: 'immediate',
            line_items: [{ description: 'RouteIQ Premium API — 10K calls/mo', qty: 10000, unit_price: quotePrice / 10000 }],
          },
        });
        break;
      }

      // ── COUNTER — buyer counter-offers ─────────────────────────
      case 'counter': {
        events.push({
          type: 'reasoning', timestamp: Date.now(), sender: 'buyer',
          agentName: 'Velocity Procurement AI',
          thought: `Meridian quoted $${quotePrice} — that's 15% above my budget ceiling of $${DEMO_AMOUNT}. This is our first contract with them, and I have 3 other providers in my pipeline. I should counter at $${DEMO_AMOUNT}.00 flat. If they accept, we save $${(quotePrice - DEMO_AMOUNT).toFixed(2)}/month — $${((quotePrice - DEMO_AMOUNT) * 12).toFixed(2)} annualized across the fleet.`,
          action: 'Sending COUNTER at budget ceiling price',
        });
        events.push({
          type: 'message', timestamp: Date.now(),
          messageType: 'COUNTER', sender: 'buyer', id: session!.counterId,
          summary: `Counter: $${DEMO_AMOUNT}.00 USDC`,
          detailRows: [
            { label: 'Proposed price', value: `$${DEMO_AMOUNT}.00 USDC` },
            { label: 'Discount requested', value: `${((1 - DEMO_AMOUNT / quotePrice) * 100).toFixed(0)}% off quoted price` },
            { label: 'Rationale', value: 'First contract — volume growth potential' },
            { label: 'Commitment', value: 'Willing to sign 6-month renewal' },
          ],
          detail: {
            proposed_price: DEMO_AMOUNT,
            rationale: `First contract, budget ceiling at $${DEMO_AMOUNT}. 6-month renewal commitment.`,
            ref_id: session!.quoteId,
          },
        });
        break;
      }

      // ── ACCEPT — seller accepts ────────────────────────────────
      case 'accept': {
        events.push({
          type: 'reasoning', timestamp: Date.now(), sender: 'seller',
          agentName: 'Meridian Sales AI',
          thought: `Velocity countered at $${DEMO_AMOUNT}.00 — below our standard but above our cost floor of $3.20. They mentioned 6-month renewal commitment. A 520-truck fleet is a strong anchor customer. Accepting: the LTV of this account at $${DEMO_AMOUNT}/mo × 12 months = $${DEMO_AMOUNT * 12} ARR, plus referral potential in their logistics network.`,
          action: 'Accepting counter-offer — revised QUOTE at $5.00',
        });
        events.push({
          type: 'message', timestamp: Date.now(),
          messageType: 'QUOTE', sender: 'seller', id: session!.acceptedQuoteId,
          summary: `Accepted ✓ $${DEMO_AMOUNT}.00 USDC`,
          detailRows: [
            { label: 'Status', value: '✓ Counter-offer accepted' },
            { label: 'Final price', value: `$${DEMO_AMOUNT}.00 USDC` },
            { label: 'Effective discount', value: `${((1 - DEMO_AMOUNT / quotePrice) * 100).toFixed(0)}% from original quote` },
            { label: 'Delivery', value: 'API key + 10K call allocation upon escrow confirmation' },
          ],
          detail: {
            price: DEMO_AMOUNT,
            currency: 'USDC',
            payment_terms: 'immediate',
            accepted: true,
          },
        });
        break;
      }

      // ── COMMIT — approve + lock USDC on-chain ─────────────────
      case 'commit': {
        events.push({
          type: 'reasoning', timestamp: Date.now(), sender: 'buyer',
          agentName: 'Velocity Procurement AI',
          thought: `Deal agreed at $${DEMO_AMOUNT}.00 USDC. Before I send the COMMIT, I need to lock the funds in the BCP escrow contract. This protects us — the USDC only releases to Meridian when they deliver a working API key with verified route data. If anything goes wrong, escrow stays locked.`,
          action: 'Locking $5.00 USDC in on-chain escrow via x402 payment flow',
        });

        const lockAmount = ethers.parseUnits(String(DEMO_AMOUNT), USDC_DECIMALS);

        // Approve if needed
        const allowance = await usdc.allowance(buyerWallet.address, CONTRACT_ADDRESS);
        let approveTxHash: string | undefined;
        if (allowance < lockAmount) {
          const usdcBuyer = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, buyerWallet);
          const approveTx = await usdcBuyer.approve(CONTRACT_ADDRESS, ethers.MaxUint256);
          const approveReceipt = await approveTx.wait();
          approveTxHash = approveReceipt.hash;
        }

        // x402 flow
        events.push({
          type: 'x402', timestamp: Date.now(), step: 'request',
          detail: { method: 'POST', endpoint: '/bcp/settle', body: `amount=${DEMO_AMOUNT}&asset=USDC` },
        });
        events.push({
          type: 'x402', timestamp: Date.now(), step: 'challenge',
          detail: { status: '402', asset: 'USDC', amount: `${DEMO_AMOUNT}.00`, network: 'Base Sepolia (84532)', receiver: sellerWallet.address },
        });
        events.push({
          type: 'x402', timestamp: Date.now(), step: 'signed',
          detail: { scheme: 'EIP-191', signer: buyerWallet.address },
        });

        // Lock USDC in escrow
        const escrowBuyer = new ethers.Contract(CONTRACT_ADDRESS, ESCROW_ABI, buyerWallet);
        const lockTx = await escrowBuyer.lockToken(
          session!.commitHash,
          buyerWallet.address,
          sellerWallet.address,
          0, // releaseAfter: immediate
          USDC_ADDRESS,
          lockAmount,
        );
        const lockReceipt = await lockTx.wait();
        session!.lockTxHash = lockReceipt.hash;
        session!.lockGasWei = BigInt(lockReceipt.gasUsed) * BigInt(lockReceipt.gasPrice ?? 0);

        events.push({
          type: 'x402', timestamp: Date.now(), step: 'settled',
          detail: {
            status: '200',
            txHash: session!.lockTxHash,
            explorerUrl: `${EXPLORER_URL}/tx/${session!.lockTxHash}`,
            gas: ethers.formatEther(session!.lockGasWei),
          },
        });

        events.push({
          type: 'message', timestamp: Date.now(),
          messageType: 'COMMIT', sender: 'buyer', id: session!.commitId,
          summary: `🔒 Escrow locked — ${DEMO_AMOUNT} USDC`,
          txHash: session!.lockTxHash,
          explorerUrl: `${EXPLORER_URL}/tx/${session!.lockTxHash}`,
          detailRows: [
            { label: 'Escrow contract', value: CONTRACT_ADDRESS.substring(0, 10) + '...' + CONTRACT_ADDRESS.substring(36) },
            { label: 'Amount locked', value: `${DEMO_AMOUNT}.00 USDC` },
            { label: 'Release condition', value: 'Delivery confirmed (FULFIL)' },
            { label: 'Dispute window', value: 'Until FULFIL or explicit freeze' },
          ],
          detail: {
            escrow_contract: CONTRACT_ADDRESS,
            amount: DEMO_AMOUNT,
            tx_hash: session!.lockTxHash,
            ...(approveTxHash ? { approve_tx: approveTxHash } : {}),
          },
        });

        events.push(await getBalances());
        break;
      }

      // ── DISPUTE — buyer raises dispute, freeze escrow ──────────
      case 'dispute': {
        events.push({
          type: 'reasoning', timestamp: Date.now(), sender: 'buyer',
          agentName: 'Velocity QA Agent',
          thought: 'I ran the first 500 route optimization calls through our validation pipeline. Result: 23% of optimized routes reference road closures that ended 48+ hours ago — the I-70 Colorado closure cleared Tuesday, but Meridian\'s API still reroutes around it. This is a data freshness SLA violation (contract requires < 15 min updates). I need to freeze the escrow before Meridian can claim the funds.',
          action: 'Calling freeze() on BCP escrow contract — funds locked until both parties agree',
        });

        // Buyer freezes escrow on-chain
        const escrowBuyerDispute = new ethers.Contract(CONTRACT_ADDRESS, ESCROW_ABI, buyerWallet);
        const freezeTx = await escrowBuyerDispute.freeze(session!.commitHash);
        const freezeReceipt = await freezeTx.wait();
        session!.freezeTxHash = freezeReceipt.hash;

        events.push({
          type: 'message', timestamp: Date.now(),
          messageType: 'DISPUTE', sender: 'buyer', id: session!.disputeId,
          summary: `🚨 Dispute — Stale route data detected`,
          txHash: session!.freezeTxHash,
          explorerUrl: `${EXPLORER_URL}/tx/${session!.freezeTxHash}`,
          detailRows: [
            { label: 'Reason', value: 'Data freshness SLA violation' },
            { label: 'Evidence', value: '23% of routes use closures > 48h stale' },
            { label: 'Example', value: 'I-70 CO closure cleared Tue, still rerouting Thu' },
            { label: 'Requested', value: 'Redeliver with fresh DOT data feed' },
            { label: 'Escrow status', value: '🔴 FROZEN — funds locked' },
          ],
          detail: {
            reason: 'quality_issue',
            requested_resolution: 'redeliver',
            escrow_status: 'frozen',
            tx_hash: session!.freezeTxHash,
          },
        });

        events.push(await getBalances());
        break;
      }

      // ── RESOLVE — both parties approve unfreeze (2-of-2) ──────
      case 'resolve': {
        events.push({
          type: 'reasoning', timestamp: Date.now(), sender: 'seller',
          agentName: 'Meridian Resolution AI',
          thought: 'Velocity filed a valid dispute — our DOT data pipeline had a 36-hour lag in the Colorado region due to a caching misconfiguration. We\'ve patched the ingestion pipeline and re-ran the affected routes. All 500 calls now return current closure data. Rather than lose this customer, I should agree to unfreeze and redeliver. The fix cost us ~$0.40 in compute vs. losing a $60/year account.',
          action: 'Both parties calling approveUnfreeze() — 2-of-2 multisig required to unfreeze',
        });

        // Buyer approves unfreeze
        const escrowBuyerUnfreeze = new ethers.Contract(CONTRACT_ADDRESS, ESCROW_ABI, buyerWallet);
        const buyerApproveTx = await escrowBuyerUnfreeze.approveUnfreeze(session!.commitHash);
        await buyerApproveTx.wait();

        // Seller approves unfreeze → triggers Unfrozen event
        const escrowSellerUnfreeze = new ethers.Contract(CONTRACT_ADDRESS, ESCROW_ABI, sellerWallet);
        const sellerApproveTx = await escrowSellerUnfreeze.approveUnfreeze(session!.commitHash);
        const sellerApproveReceipt = await sellerApproveTx.wait();
        session!.unfreezeTxHash = sellerApproveReceipt.hash;

        events.push({
          type: 'message', timestamp: Date.now(),
          messageType: 'RESOLVE', sender: 'seller', id: uuidv4(),
          summary: `✅ Resolved — Escrow unfrozen (2-of-2 multisig)`,
          txHash: session!.unfreezeTxHash,
          explorerUrl: `${EXPLORER_URL}/tx/${session!.unfreezeTxHash}`,
          detailRows: [
            { label: 'Buyer approval', value: '✓ Signed' },
            { label: 'Seller approval', value: '✓ Signed' },
            { label: 'Root cause', value: 'DOT data pipeline caching lag (patched)' },
            { label: 'Resolution', value: 'Redelivered 500 calls with fresh data' },
            { label: 'Escrow status', value: '🟢 UNFROZEN — release eligible' },
          ],
          detail: {
            buyer_approved: true,
            seller_approved: true,
            escrow_status: 'unlocked',
            resolution: 'Pipeline patched, 500 calls redelivered with fresh data',
            tx_hash: session!.unfreezeTxHash,
          },
        });

        events.push(await getBalances());
        break;
      }

      // ── FULFIL — release escrow on-chain ───────────────────────
      case 'fulfil': {
        events.push({
          type: 'reasoning', timestamp: Date.now(), sender: 'seller',
          agentName: 'Meridian Delivery AI',
          thought: `Dispute resolved — Velocity confirmed the redelivered routes are accurate with < 12 min data freshness. All 10,000 API call credits are now active on their account. Time to release the escrow and generate the UBL 2.1 invoice. This closes the transaction — $${DEMO_AMOUNT}.00 USDC will transfer from the escrow contract to our wallet.`,
          action: 'Calling release() on BCP escrow — USDC transfers to seller',
        });

        const escrowSeller = new ethers.Contract(CONTRACT_ADDRESS, ESCROW_ABI, sellerWallet);
        const releaseTx = await escrowSeller.release(session!.commitHash);
        const releaseReceipt = await releaseTx.wait();
        session!.releaseTxHash = releaseReceipt.hash;
        session!.releaseGasWei = BigInt(releaseReceipt.gasUsed) * BigInt(releaseReceipt.gasPrice ?? 0);

        events.push({
          type: 'message', timestamp: Date.now(),
          messageType: 'FULFIL', sender: 'seller', id: session!.fulfilId,
          summary: `💸 Payment released — ${DEMO_AMOUNT} USDC settled`,
          txHash: session!.releaseTxHash,
          explorerUrl: `${EXPLORER_URL}/tx/${session!.releaseTxHash}`,
          detailRows: [
            { label: 'Invoice', value: `${session!.invoiceId} (UBL 2.1)` },
            { label: 'Amount', value: `$${DEMO_AMOUNT}.00 USDC` },
            { label: 'Delivered', value: '10,000 RouteIQ API calls activated' },
            { label: 'Settlement', value: 'Escrow → Seller wallet (instant)' },
          ],
          detail: {
            invoice_id: session!.invoiceId,
            invoice_format: 'UBL 2.1',
            tx_hash: session!.releaseTxHash,
          },
        });

        events.push(await getBalances());

        // Generate real UBL 2.1 invoice
        const { xml: invoiceXml } = generateUBLInvoice({
          invoiceId: session!.invoiceId,
          buyerName: 'Velocity Logistics Inc.',
          buyerWallet: buyerWallet.address,
          sellerName: 'Meridian Intelligence Corp.',
          sellerWallet: sellerWallet.address,
          escrowContract: CONTRACT_ADDRESS,
          currency: 'USD',
          amount: DEMO_AMOUNT,
          lineItems: [
            { description: 'RouteIQ Fleet Optimization API — 10,000 call credit', qty: 10000, unit: 'CALL', unitPrice: DEMO_AMOUNT / 10000 },
          ],
          txHash: session!.releaseTxHash,
        });

        // Emit done/receipt immediately so the UI shows it
        const totalGas = session!.lockGasWei + session!.releaseGasWei;
        const elapsed = Math.round((Date.now() - session!.startTime) / 1000);
        events.push({
          type: 'done', timestamp: Date.now(),
          lockTxHash: session!.lockTxHash,
          releaseTxHash: session!.releaseTxHash,
          resetTxHash: '',
          lockUrl: `${EXPLORER_URL}/tx/${session!.lockTxHash}`,
          releaseUrl: `${EXPLORER_URL}/tx/${session!.releaseTxHash}`,
          resetUrl: '',
          invoiceId: session!.invoiceId,
          invoiceXml,
          price: `${DEMO_AMOUNT}`,
          elapsed,
          gasCost: `$${(Number(ethers.formatEther(totalGas)) * 2500).toFixed(4)}`,
        });

        break;
      }

      // ── RESET — transfer USDC back to buyer for next run ────
      case 'reset': {
        const sellerFinal = await usdc.balanceOf(sellerWallet.address);
        let resetTxHash = '';
        if (sellerFinal > 0n) {
          const usdcSeller = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, sellerWallet);
          const resetTx = await usdcSeller.transfer(buyerWallet.address, sellerFinal);
          const resetReceipt = await resetTx.wait();
          resetTxHash = resetReceipt.hash;
        }

        events.push(await getBalances());

        // Update the done data with the reset tx hash
        if (resetTxHash) {
          events.push({
            type: 'done', timestamp: Date.now(),
            lockTxHash: session!.lockTxHash,
            releaseTxHash: session!.releaseTxHash,
            resetTxHash,
            lockUrl: `${EXPLORER_URL}/tx/${session!.lockTxHash}`,
            releaseUrl: `${EXPLORER_URL}/tx/${session!.releaseTxHash}`,
            resetUrl: `${EXPLORER_URL}/tx/${resetTxHash}`,
            invoiceId: session!.invoiceId,
            price: `${DEMO_AMOUNT}`,
            elapsed: Math.round((Date.now() - session!.startTime) / 1000),
            gasCost: '',
          });
        }

        session = null;
        break;
      }
    }

    return NextResponse.json({ events });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (['init', 'commit', 'fulfil', 'reset'].includes(step)) {
      session = null;
    }
    return NextResponse.json(
      { events: [{ type: 'error', timestamp: Date.now(), message }] },
      { status: 500 },
    );
  }
}
