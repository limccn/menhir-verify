/**
 * @limccn/menhir-verify — verifier-only package.
 *
 * Trust invariant: expected digests and commitment fields come from chain
 * state, never from the caller or the gateway. The package imports no Node
 * built-ins and no wallet/CLI code.
 */

export { VerifyError } from './errors.js';
export type { VerifyErrorCode, VerifyErrorOptions } from './errors.js';
export { makeReader } from './reader.js';
export type { VerifyReader } from './reader.js';
// `assembleReport` stays internal: it takes expected commitment fields as
// arguments, so exporting it would offer a caller-supplied-expected path that
// the package's trust invariant forbids.
export type { VerifyReport, VerifyVerdict } from './report.js';
export { fetchFromGateway } from './transport.js';
export { verifyByCid, verifyBytes } from './verify.js';
export type { VerifyByCidArgs, VerifyBytesArgs } from './verify.js';

// Convenience re-exports: callers often need the same hash rules to build or
// inspect a commitment. These are the core implementations, not copies.
export { cidDigest, commitmentHash } from '@limccn/menhir-core';
