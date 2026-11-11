/**
 * Typed errors for the verifier package.
 *
 * A digest mismatch is NOT an error: it is a valid verification outcome
 * (`digestMatch: false`, `verdict: 'content-mismatch'`). These codes cover
 * failures to *perform* a verification, plus the two trust-boundary failures
 * (`HASH_UNRESOLVED`, `CHAIN_MISMATCH`).
 */

export type VerifyErrorCode =
  | 'INVALID_INPUT'
  | 'HASH_UNRESOLVED'
  | 'CHAIN_MISMATCH'
  | 'OWNER_MISMATCH'
  | 'RPC_ERROR'
  | 'FETCH_ERROR';

export interface VerifyErrorOptions {
  detail?: string;
  cause?: unknown;
  expected?: string;
  actual?: string;
}

export class VerifyError extends Error {
  readonly code: VerifyErrorCode;
  readonly detail: string | undefined;
  readonly expected: string | undefined;
  readonly actual: string | undefined;

  constructor(code: VerifyErrorCode, options: VerifyErrorOptions = {}) {
    super(options.detail ?? code, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'VerifyError';
    this.code = code;
    this.detail = options.detail;
    this.expected = options.expected;
    this.actual = options.actual;
  }
}
