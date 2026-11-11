/**
 * Verification entry points.
 *
 * The caller supplies bytes and a commitment hash; expected values come only
 * from the reader (chain state). No expected digest and no hash function is
 * injectable.
 */

import type { Address, Bytes32 } from '@limccn/menhir-core';

import { VerifyError } from './errors.js';
import type { VerifyReader } from './reader.js';
import { assembleReport, type VerifyReport } from './report.js';
import { fetchFromGateway } from './transport.js';

const HEX_32 = /^0x[0-9a-fA-F]{64}$/;
const HEX_20 = /^0x[0-9a-fA-F]{40}$/;

export interface VerifyBytesArgs {
  reader: VerifyReader;
  commitmentHash: Bytes32;
  /** Bytes held by the caller; no pinning or gateway required. */
  bytes: Uint8Array;
  /** Optional expected owner; a mismatch is OWNER_MISMATCH. */
  owner?: Address;
}

export interface VerifyByCidArgs {
  reader: VerifyReader;
  commitmentHash: Bytes32;
  cid: string;
  /** Base URL of an IPFS gateway, e.g. https://ipfs.io/ipfs */
  gateway: string;
  owner?: Address;
  signal?: AbortSignal;
}

function assertHex(value: string, length: 20 | 32, label: string): void {
  const pattern = length === 32 ? HEX_32 : HEX_20;
  if (!pattern.test(value)) {
    throw new VerifyError('INVALID_INPUT', {
      detail: `${label} must be ${length}-byte hex, got ${value}`,
    });
  }
}

export async function verifyBytes(args: VerifyBytesArgs): Promise<VerifyReport> {
  const { reader, commitmentHash, bytes, owner } = args;

  assertHex(commitmentHash, 32, 'commitmentHash');
  if (owner !== undefined) assertHex(owner, 20, 'owner');
  if (!(bytes instanceof Uint8Array)) {
    throw new VerifyError('INVALID_INPUT', { detail: 'bytes must be a Uint8Array' });
  }
  if (bytes.length === 0) {
    throw new VerifyError('INVALID_INPUT', { detail: 'bytes must not be empty' });
  }

  const chainDeep = await reader.isDeep(commitmentHash);
  if (!chainDeep) {
    throw new VerifyError('HASH_UNRESOLVED', {
      detail: `no commitment ${commitmentHash} is deep on this registry`,
    });
  }

  const commitment = await reader.getCommitment(commitmentHash);
  if (owner !== undefined && commitment.owner.toLowerCase() !== owner.toLowerCase()) {
    throw new VerifyError('OWNER_MISMATCH', {
      detail: `commitment owner is ${commitment.owner}, not ${owner}`,
      expected: owner,
      actual: commitment.owner,
    });
  }

  const [replacedBy, chainActive] = await Promise.all([
    reader.replacedByOf(commitmentHash),
    reader.isActive(commitmentHash),
  ]);

  return assembleReport({
    hash: commitmentHash,
    commitment,
    replacedBy,
    bytes,
    chainDeep,
    chainActive,
    ...(reader.registry === undefined ? {} : { registry: reader.registry }),
    ...(reader.chainId === undefined ? {} : { chainId: reader.chainId }),
  });
}

export async function verifyByCid(args: VerifyByCidArgs): Promise<VerifyReport> {
  const bytes = await fetchFromGateway(args.gateway, args.cid, args.signal);
  return verifyBytes({
    reader: args.reader,
    commitmentHash: args.commitmentHash,
    bytes,
    ...(args.owner === undefined ? {} : { owner: args.owner }),
  });
}
