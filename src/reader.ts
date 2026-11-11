/**
 * Chain reader used by the verifier.
 *
 * The package reads every expected value through this interface. `makeReader`
 * is the only implementation that touches an RPC; tests and integrators may
 * inject their own reader (for example a cached one), but they still cannot
 * supply expected digests directly to `verifyBytes`.
 */

import {
  memoryRegistryAbi,
  type Address,
  type Bytes32,
  type Commitment,
} from '@limccn/menhir-core';
import type { PublicClient } from 'viem';

import { VerifyError } from './errors.js';

export interface VerifyReader {
  /** Set by `makeReader`; echoed into the report when present. */
  readonly registry?: Address;
  /** Set by `makeReader` from `client.chain.id`; echoed into the report. */
  readonly chainId?: number;
  getCommitment(hash: Bytes32): Promise<Commitment>;
  isDeep(hash: Bytes32): Promise<boolean>;
  isActive(hash: Bytes32): Promise<boolean>;
  replacedByOf(hash: Bytes32): Promise<Bytes32>;
}

export function makeReader(client: PublicClient, registry: Address): VerifyReader {
  async function read<T>(functionName: string, args: readonly unknown[]): Promise<T> {
    try {
      return (await client.readContract({
        address: registry,
        abi: memoryRegistryAbi,
        functionName,
        args,
      } as never)) as T;
    } catch (error) {
      throw new VerifyError('RPC_ERROR', {
        detail: `${functionName} failed on ${registry}`,
        cause: error,
      });
    }
  }

  return {
    registry,
    ...(client.chain === undefined ? {} : { chainId: client.chain.id }),
    getCommitment: (hash) => read<Commitment>('getCommitment', [hash]),
    isDeep: (hash) => read<boolean>('isDeep', [hash]),
    isActive: (hash) => read<boolean>('isActive', [hash]),
    replacedByOf: (hash) => read<Bytes32>('replacedByOf', [hash]),
  };
}
