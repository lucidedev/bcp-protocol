/**
 * Tests for BCP message creation and validation.
 */

import { v4 as uuidv4 } from 'uuid';
import { validateMessage, ValidationResult } from '../src/validation/validator';
import { IntentMessage } from '../src/messages/intent';
import { QuoteMessage } from '../src/messages/quote';
import { CounterMessage } from '../src/messages/counter';
import { CommitMessage } from '../src/messages/commit';
import { FulfilMessage } from '../src/messages/fulfil';
import { DisputeMessage } from '../src/messages/dispute';

function makeIntent(overrides: Partial<IntentMessage> = {}): IntentMessage {
  return {
    bcp_version: '0.1',
    message_type: 'INTENT',
    intent_id: uuidv4(),
    timestamp: new Date().toISOString(),
    buyer: {
      org_id: 'test-org',
      agent_wallet_address: '0x' + 'a'.repeat(64),
      credential: '0x' + 'b'.repeat(64),
      spending_limit: 50000,
      currency: 'USDC',
    },
    requirements: {
      category: 'Cloud Services',
      quantity: 10,
      delivery_window: 'P14D',
      budget_max: 50000,
      payment_terms_acceptable: ['immediate', 'net30'],
      compliance: ['ISO27001'],
    },
    ttl: 3600,
    signature: 'a'.repeat(128),
    ...overrides,
  };
}

function makeQuote(intentId: string, overrides: Partial<QuoteMessage> = {}): QuoteMessage {
  return {
    bcp_version: '0.1',
    message_type: 'QUOTE',
    quote_id: uuidv4(),
    intent_id: intentId,
    timestamp: new Date().toISOString(),
    seller: {
      org_id: 'seller-org',
      agent_wallet_address: '0x' + 'c'.repeat(64),
      credential: '0x' + 'd'.repeat(64),
    },
    offer: {
      price: 45000,
      currency: 'USDC',
      payment_terms: 'net30',
      delivery_date: new Date(Date.now() + 14 * 86400_000).toISOString(),
      validity_until: new Date(Date.now() + 7 * 86400_000).toISOString(),
      line_items: [
        { description: 'GPU Instance', qty: 10, unit_price: 4500, unit: 'EA' },
      ],
    },
    signature: 'a'.repeat(128),
    ...overrides,
  };
}

describe('INTENT message validation', () => {
  test('valid INTENT passes validation', () => {
    const result: ValidationResult = validateMessage(makeIntent() as unknown as Record<string, unknown>);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('missing required field fails validation', () => {
    const msg = makeIntent();
    delete (msg as any).intent_id;
    const result = validateMessage(msg as unknown as Record<string, unknown>);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test('invalid payment_terms_acceptable fails validation', () => {
    const msg = makeIntent();
    msg.requirements.payment_terms_acceptable = ['invalid_term' as any];
    const result = validateMessage(msg as unknown as Record<string, unknown>);
    expect(result.valid).toBe(false);
  });

  test('invalid bcp_version fails validation', () => {
    const msg = makeIntent({ bcp_version: '9.9' as any });
    const result = validateMessage(msg as unknown as Record<string, unknown>);
    expect(result.valid).toBe(false);
  });
});

describe('QUOTE message validation', () => {
  test('valid QUOTE passes validation', () => {
    const result = validateMessage(makeQuote(uuidv4()) as unknown as Record<string, unknown>);
    expect(result.valid).toBe(true);
  });

  test('QUOTE with early_pay_discount passes', () => {
    const quote = makeQuote(uuidv4());
    quote.offer.early_pay_discount = { discount_percent: 2, if_paid_within_days: 10 };
    const result = validateMessage(quote as unknown as Record<string, unknown>);
    expect(result.valid).toBe(true);
  });

  test('QUOTE with empty line_items fails', () => {
    const quote = makeQuote(uuidv4());
    quote.offer.line_items = [];
    const result = validateMessage(quote as unknown as Record<string, unknown>);
    expect(result.valid).toBe(false);
  });
});

describe('COUNTER message validation', () => {
  test('valid COUNTER passes validation', () => {
    const counter: CounterMessage = {
      bcp_version: '0.1',
      message_type: 'COUNTER',
      counter_id: uuidv4(),
      ref_id: uuidv4(),
      initiated_by: 'buyer',
      timestamp: new Date().toISOString(),
      proposed_changes: { price: 40000 },
      new_validity_until: new Date(Date.now() + 3600_000).toISOString(),
      signature: 'a'.repeat(128),
    };
    const result = validateMessage(counter as unknown as Record<string, unknown>);
    expect(result.valid).toBe(true);
  });
});

describe('COMMIT message validation', () => {
  test('valid COMMIT passes validation', () => {
    const commit: CommitMessage = {
      bcp_version: '0.1',
      message_type: 'COMMIT',
      commit_id: uuidv4(),
      accepted_ref_id: uuidv4(),
      timestamp: new Date().toISOString(),
      buyer_approval: {
        approved_by: '0x' + 'a'.repeat(64),
        approval_type: 'autonomous',
        threshold_exceeded: false,
      },
      escrow: {
        amount: 45000,
        currency: 'USDC',
        escrow_contract_address: '0x' + 'e'.repeat(40),
        release_condition: 'fulfil_confirmed',
        payment_schedule: {
          type: 'net30',
          due_date: new Date(Date.now() + 30 * 86400_000).toISOString(),
        },
      },
      signature: 'a'.repeat(128),
    };
    const result = validateMessage(commit as unknown as Record<string, unknown>);
    expect(result.valid).toBe(true);
  });
});

describe('FULFIL message validation', () => {
  test('valid FULFIL passes validation', () => {
    const fulfil: FulfilMessage = {
      bcp_version: '0.1',
      message_type: 'FULFIL',
      fulfil_id: uuidv4(),
      commit_id: uuidv4(),
      timestamp: new Date().toISOString(),
      delivery_proof: {
        type: 'service_confirmation',
        evidence: 'Delivery confirmed',
      },
      invoice: {
        format: 'UBL2.1',
        invoice_id: 'INV-001',
        invoice_hash: 'a'.repeat(64),
        invoice_url: 'https://example.com/invoice/INV-001',
      },
      settlement_trigger: 'immediate',
      signature: 'a'.repeat(128),
    };
    const result = validateMessage(fulfil as unknown as Record<string, unknown>);
    expect(result.valid).toBe(true);
  });
});

describe('DISPUTE message validation', () => {
  test('valid DISPUTE passes validation', () => {
    const dispute: DisputeMessage = {
      bcp_version: '0.1',
      message_type: 'DISPUTE',
      dispute_id: uuidv4(),
      commit_id: uuidv4(),
      timestamp: new Date().toISOString(),
      raised_by: 'buyer',
      reason: 'non_delivery',
      requested_resolution: 'full_refund',
      signature: 'a'.repeat(128),
    };
    const result = validateMessage(dispute as unknown as Record<string, unknown>);
    expect(result.valid).toBe(true);
  });

  test('DISPUTE with optional evidence fields passes', () => {
    const dispute: DisputeMessage = {
      bcp_version: '0.1',
      message_type: 'DISPUTE',
      dispute_id: uuidv4(),
      commit_id: uuidv4(),
      timestamp: new Date().toISOString(),
      raised_by: 'seller',
      reason: 'payment_failure',
      evidence_hash: 'b'.repeat(64),
      evidence_url: 'https://example.com/evidence',
      requested_resolution: 'negotiate',
      signature: 'a'.repeat(128),
    };
    const result = validateMessage(dispute as unknown as Record<string, unknown>);
    expect(result.valid).toBe(true);
  });
});

describe('unknown message type', () => {
  test('rejects unknown message_type', () => {
    const result = validateMessage({ message_type: 'UNKNOWN', bcp_version: '0.1' });
    expect(result.valid).toBe(false);
    expect(result.errors[0].path).toBe('/message_type');
  });
});
