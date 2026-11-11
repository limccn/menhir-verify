/**
 * Report assembly. Every expected field comes from the commitment struct the
 * caller's reader returned; the only values computed here are the two digests
 * over the supplied bytes.
 */

import {
  canonicalBytes,
  cidDigest,
  commitmentHash as computeCommitmentHash,
  isZeroBytes32,
  parseMemoryContent,
  type Address,
  type Bytes32,
  type Commitment,
} from '@limccn/menhir-core';
import { keccak256 } from 'viem';

import { VerifyError } from './errors.js';

export type VerifyVerdict = 'verified' | 'retracted' | 'content-mismatch';

export interface VerifyReport {
  /** Wire schema version; bump on breaking report changes. */
  schema: 'menhir-verify/1';
  registry?: Address;
  chainId?: number;
  commitmentHash: Bytes32;
  owner: Address;
  signer: Address;
  op: 0 | 1;
  prev: Bytes32;
  /** Zero bytes32 (no successor) is reported as null. */
  replacedBy: Bytes32 | null;
  /** Decimal string: JSON-safe for bigint block heights. */
  blockHeight: string;
  /** Expected values, read from `getCommitment(H)`. */
  contentHash: Bytes32;
  cidDigest: Bytes32;
  /** Values recomputed over the supplied bytes. */
  computedContentHash: Bytes32;
  computedCidDigest: Bytes32;
  hashMatch: boolean;
  digestMatch: boolean;
  /** deep on chain AND both digests match. */
  anchored: boolean;
  /** active on chain AND both digests match. */
  active: boolean;
  chainDeep: boolean;
  chainActive: boolean;
  bytesLength: number;
  verdict: VerifyVerdict;
}

export interface AssembleReportArgs {
  hash: Bytes32;
  commitment: Commitment;
  replacedBy: Bytes32;
  bytes: Uint8Array;
  chainDeep: boolean;
  chainActive: boolean;
  registry?: Address;
  chainId?: number;
}

const HEX_32 = /^0x[0-9a-fA-F]{64}$/;
const HEX_20 = /^0x[0-9a-fA-F]{40}$/;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** keccak256(JCS(parse(bytes))) — content-level; tolerates non-canonical JSON. */
function contentHashOf(bytes: Uint8Array): Bytes32 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    throw new VerifyError('INVALID_INPUT', { detail: 'bytes are not JSON', cause: error });
  }
  try {
    return keccak256(canonicalBytes(parseMemoryContent(parsed)));
  } catch (error) {
    throw new VerifyError('INVALID_INPUT', { detail: messageOf(error), cause: error });
  }
}

export function assembleReport(args: AssembleReportArgs): VerifyReport {
  const { hash, commitment, replacedBy, bytes, chainDeep, chainActive } = args;

  if (
    !HEX_32.test(commitment.contentHash) ||
    !HEX_32.test(commitment.cidDigest) ||
    !HEX_32.test(commitment.prev)
  ) {
    throw new VerifyError('CHAIN_MISMATCH', {
      detail: `commitment ${hash} contains a malformed bytes32 field`,
    });
  }
  if (!HEX_20.test(commitment.owner) || !HEX_20.test(commitment.signer)) {
    throw new VerifyError('CHAIN_MISMATCH', {
      detail: `commitment ${hash} contains a malformed address field`,
    });
  }
  if (commitment.op !== 0 && commitment.op !== 1) {
    throw new VerifyError('CHAIN_MISMATCH', {
      detail: `commitment ${hash} has an invalid op: ${String(commitment.op)}`,
    });
  }
  if (!HEX_32.test(replacedBy)) {
    throw new VerifyError('CHAIN_MISMATCH', {
      detail: `replacedByOf(${hash}) is not a bytes32 value`,
    });
  }

  let recomputedCommitmentHash: Bytes32;
  try {
    recomputedCommitmentHash = computeCommitmentHash(commitment);
  } catch (error) {
    // A struct the ABI cannot encode (e.g. a malformed blockHeight from a
    // custom reader) is a chain-read inconsistency, not a caller input error.
    throw new VerifyError('CHAIN_MISMATCH', {
      detail: `getCommitment(${hash}) returned a struct that cannot be encoded: ${messageOf(error)}`,
      cause: error,
    });
  }
  if (recomputedCommitmentHash.toLowerCase() !== hash.toLowerCase()) {
    throw new VerifyError('CHAIN_MISMATCH', {
      detail:
        `getCommitment(${hash}) returned a struct that hashes to ` +
        `${recomputedCommitmentHash}; the RPC or registry address is inconsistent`,
    });
  }

  const computedContentHash = contentHashOf(bytes);
  const computedCidDigest = cidDigest(bytes);
  const hashMatch = commitment.contentHash.toLowerCase() === computedContentHash.toLowerCase();
  const digestMatch = commitment.cidDigest.toLowerCase() === computedCidDigest.toLowerCase();
  const anchored = chainDeep && hashMatch && digestMatch;
  const active = chainActive && hashMatch && digestMatch;
  const verdict: VerifyVerdict =
    !hashMatch || !digestMatch ? 'content-mismatch' : !chainActive ? 'retracted' : 'verified';

  return {
    schema: 'menhir-verify/1',
    ...(args.registry === undefined ? {} : { registry: args.registry }),
    ...(args.chainId === undefined ? {} : { chainId: args.chainId }),
    commitmentHash: hash,
    owner: commitment.owner,
    signer: commitment.signer,
    op: commitment.op,
    prev: commitment.prev,
    replacedBy: isZeroBytes32(replacedBy) ? null : replacedBy,
    blockHeight: commitment.blockHeight.toString(),
    contentHash: commitment.contentHash,
    cidDigest: commitment.cidDigest,
    computedContentHash,
    computedCidDigest,
    hashMatch,
    digestMatch,
    anchored,
    active,
    chainDeep,
    chainActive,
    bytesLength: bytes.length,
    verdict,
  };
}
