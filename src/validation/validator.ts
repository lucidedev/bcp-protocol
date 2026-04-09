/**
 * BCP message validator — validates all messages against JSON schemas using ajv.
 * @module validation/validator
 */

import Ajv, { ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';

import intentSchema from '../../spec/schemas/intent.schema.json';
import quoteSchema from '../../spec/schemas/quote.schema.json';
import counterSchema from '../../spec/schemas/counter.schema.json';
import commitSchema from '../../spec/schemas/commit.schema.json';
import fulfilSchema from '../../spec/schemas/fulfil.schema.json';
import acceptSchema from '../../spec/schemas/accept.schema.json';
import disputeSchema from '../../spec/schemas/dispute.schema.json';

/** Structured validation error with field path */
export interface ValidationError {
  path: string;
  message: string;
  keyword: string;
}

/** Validation result */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/** BCP message types */
export type BCPMessageType = 'intent' | 'quote' | 'counter' | 'commit' | 'fulfil' | 'accept' | 'dispute';

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const validators: Record<BCPMessageType, ReturnType<typeof ajv.compile>> = {
  intent: ajv.compile(intentSchema),
  quote: ajv.compile(quoteSchema),
  counter: ajv.compile(counterSchema),
  commit: ajv.compile(commitSchema),
  fulfil: ajv.compile(fulfilSchema),
  accept: ajv.compile(acceptSchema),
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

/**
 * Validate a BCP message against its JSON schema.
 */
export function validateMessage(message: Record<string, unknown>): ValidationResult {
  const messageType = message.type as BCPMessageType | undefined;

  if (!messageType || !validators[messageType]) {
    return {
      valid: false,
      errors: [{
        path: '/type',
        message: `Unknown or missing type: ${messageType}`,
        keyword: 'enum',
      }],
    };
  }

  const validate = validators[messageType];
  const valid = validate(message) as boolean;

  return {
    valid,
    errors: valid ? [] : formatErrors(validate.errors),
  };
}

/**
 * Validate a BCP message of a known type.
 */
export function validateMessageType(
  messageType: BCPMessageType,
  message: Record<string, unknown>
): ValidationResult {
  const validate = validators[messageType];
  if (!validate) {
    return {
      valid: false,
      errors: [{ path: '/type', message: `Unknown type: ${messageType}`, keyword: 'enum' }],
    };
  }
  const valid = validate(message) as boolean;
  return { valid, errors: valid ? [] : formatErrors(validate.errors) };
}
