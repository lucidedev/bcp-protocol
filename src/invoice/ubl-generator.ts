/**
 * UBL 2.1 invoice generator — generates minimal valid UBL 2.1 Invoice XML
 * from committed quote line items and fulfilment data.
 *
 * @module invoice/ubl-generator
 */

import { createHash } from 'crypto';
import { QuoteMessage } from '../messages/quote';
import { CommitMessage } from '../messages/commit';
import { FulfilMessage } from '../messages/fulfil';

/** Generated UBL invoice result */
export interface UBLInvoiceResult {
  /** The invoice XML string */
  xml: string;
  /** SHA-256 hash of the XML */
  hash: string;
  /** Invoice ID */
  invoice_id: string;
}

/**
 * Escape special XML characters in a string.
 * @param str - The string to escape
 * @returns XML-safe string
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Generate a UBL 2.1 Invoice XML from BCP quote, commit, and fulfil data.
 *
 * Produces a minimal valid UBL 2.1 Invoice document compliant with
 * the OASIS Universal Business Language 2.1 specification.
 *
 * @param quote - The accepted QUOTE message (contains line items and seller info)
 * @param commit - The COMMIT message (contains buyer info and PO reference)
 * @param fulfil - The FULFIL message (contains invoice metadata)
 * @returns UBL invoice result with XML, hash, and invoice ID
 */
export function generateUBLInvoice(
  quote: QuoteMessage,
  commit: CommitMessage,
  fulfil: FulfilMessage
): UBLInvoiceResult {
  const invoiceId = fulfil.invoice.invoice_id;
  const issueDate = fulfil.timestamp.split('T')[0];
  const dueDate = commit.escrow.payment_schedule.due_date.split('T')[0];

  const lineItemsXml = quote.offer.line_items
    .map((item, index) => {
      const lineTotal = item.qty * item.unit_price;
      return `
    <cac:InvoiceLine>
      <cbc:ID>${index + 1}</cbc:ID>
      <cbc:InvoicedQuantity unitCode="${escapeXml(item.unit)}">${item.qty}</cbc:InvoicedQuantity>
      <cbc:LineExtensionAmount currencyID="${escapeXml(quote.offer.currency)}">${lineTotal.toFixed(2)}</cbc:LineExtensionAmount>
      <cac:Item>
        <cbc:Name>${escapeXml(item.description)}</cbc:Name>
      </cac:Item>
      <cac:Price>
        <cbc:PriceAmount currencyID="${escapeXml(quote.offer.currency)}">${item.unit_price.toFixed(2)}</cbc:PriceAmount>
      </cac:Price>
    </cac:InvoiceLine>`;
    })
    .join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:ID>${escapeXml(invoiceId)}</cbc:ID>
  <cbc:IssueDate>${issueDate}</cbc:IssueDate>
  <cbc:DueDate>${dueDate}</cbc:DueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${escapeXml(quote.offer.currency)}</cbc:DocumentCurrencyCode>
  <cbc:BuyerReference>${escapeXml(commit.po_reference || commit.commit_id)}</cbc:BuyerReference>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID>${escapeXml(quote.seller.org_id)}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyName>
        <cbc:Name>${escapeXml(quote.seller.org_id)}</cbc:Name>
      </cac:PartyName>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID>${escapeXml(commit.buyer_approval.approved_by)}</cbc:ID>
      </cac:PartyIdentification>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>ZZZ</cbc:PaymentMeansCode>
    <cbc:PaymentID>${escapeXml(commit.escrow.escrow_contract_address)}</cbc:PaymentID>
  </cac:PaymentMeans>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${escapeXml(quote.offer.currency)}">${quote.offer.price.toFixed(2)}</cbc:LineExtensionAmount>
    <cbc:PayableAmount currencyID="${escapeXml(quote.offer.currency)}">${quote.offer.price.toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>${lineItemsXml}
</Invoice>`;

  const hash = createHash('sha256').update(xml, 'utf8').digest('hex');

  return {
    xml,
    hash,
    invoice_id: invoiceId,
  };
}
