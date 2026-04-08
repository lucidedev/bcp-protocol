/**
 * BCP v0.2 message validator — validates against lean JSON schemas.
 * @module validation/validator-v2
 */

import Ajv, { ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';

import intentSchema from '../../spec/schemas/v2/intent.schema.json';
import quoteSchema from '../../spec/schemas/v2/quote.schema.json';
import counterSchema from '../../spec/schemas/v2/counter.schema.json';
import commitSchema from '../../spec/schemas/v2/commit.schema.json';
import fulfilSchema from '../../spec/schemas/v2/fulfil.schema.json';
import disputeSchema from '../../spec/schemas/v2/dispute.schema.json';

export interface ValidationError {
  path: string;
  message: string;
  keyword: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/** v0.2 message types (lowercase) */
export type BCPMessageTypeV2 = 'intent' | 'quote' | 'counter' | 'commit' | 'fulfil' | 'dispute';

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const validators: Record<BCPMessageTypeV2, ReturnType<typeof ajv.compile>> = {
  intent:  ajv.compile(intentSchema),
  quote:   ajv.compile(quoteSchema),
  counter: ajv.compile(counterSchema),
  commit:  ajv.compile(commitSchema),
  fulfil:  ajv.compile(fulfilSchema),
  dispute: ajv.compile(disputeSchema),
};

function formatErrors(errors: ErrorObject[] | null | undefined): ValidationError[] {
  if (!errors) return [];
  return errors.map((err) => ({
    path: err.instancePath || '/',
    message: err.message || 'Unknown validation error',
    keyword: err.keyword,
  }));
}

/** Validate a v0.2 BCP message */
export function validateMessageV2(message: Record<string, unknown>): ValidationResult {
  const type = message.type as BCPMessageTypeV2 | undefined;

  if (!type || !validators[type]) {
    return {
      valid: false,
      errors: [{ path: '/type', message: `Unknown or missing type: ${type}`, keyword: 'enum' }],
    };
  }

  const validate = validators[type];
  const valid = validate(message) as boolean;

  return {
    valid,
    errors: valid ? [] : formatErrors(validate.errors),
  };
}

/** Validate a message against a specific type schema */
export function validateMessageTypeV2(type: BCPMessageTypeV2, message: Record<string, unknown>): ValidationResult {
  const validate = validators[type];
  if (!validate) {
    return {
      valid: false,
      errors: [{ path: '/type', message: `Unknown type: ${type}`, keyword: 'enum' }],
    };
  }
  const valid = validate(message) as boolean;
  return {
    valid,
    errors: valid ? [] : formatErrors(validate.errors),
  };
}
