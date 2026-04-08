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
import disputeSchema from '../../spec/schemas/dispute.schema.json';

/** Structured validation error with field path */
export interface ValidationError {
  /** JSON pointer path to the invalid field */
  path: string;
  /** Human-readable error message */
  message: string;
  /** Schema keyword that failed (e.g. "required", "type", "enum") */
  keyword: string;
}

/** Validation result */
export interface ValidationResult {
  /** Whether the message is valid */
  valid: boolean;
  /** Validation errors (empty if valid) */
  errors: ValidationError[];
}

/** BCP message types */
export type BCPMessageType = 'INTENT' | 'QUOTE' | 'COUNTER' | 'COMMIT' | 'FULFIL' | 'DISPUTE';

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const validators: Record<BCPMessageType, ReturnType<typeof ajv.compile>> = {
  INTENT: ajv.compile(intentSchema),
  QUOTE: ajv.compile(quoteSchema),
  COUNTER: ajv.compile(counterSchema),
  COMMIT: ajv.compile(commitSchema),
  FULFIL: ajv.compile(fulfilSchema),
  DISPUTE: ajv.compile(disputeSchema),
};

/**
 * Convert ajv errors to structured ValidationError array.
 * @param errors - Raw ajv error objects
 * @returns Structured validation errors
 */
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
 * @param message - The message object to validate
 * @returns Validation result with structured errors
 */
export function validateMessage(message: Record<string, unknown>): ValidationResult {
  const messageType = message.message_type as BCPMessageType | undefined;

  if (!messageType || !validators[messageType]) {
    return {
      valid: false,
      errors: [{
        path: '/message_type',
        message: `Unknown or missing message_type: ${messageType}`,
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
 * @param messageType - The expected message type
 * @param message - The message object to validate
 * @returns Validation result with structured errors
 */
export function validateMessageType(
  messageType: BCPMessageType,
  message: Record<string, unknown>
): ValidationResult {
  const validate = validators[messageType];
  if (!validate) {
    return {
      valid: false,
      errors: [{ path: '/', message: `No schema for type: ${messageType}`, keyword: 'enum' }],
    };
  }
  const valid = validate(message) as boolean;
  return {
    valid,
    errors: valid ? [] : formatErrors(validate.errors),
  };
}
