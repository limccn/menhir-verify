import {
  canonicalBytes,
  cidDigest,
  commitmentHash,
  contentHash,
  parseMemoryContent,
  ZERO_BYTES32,
  type Commitment,
} from '@limccn/menhir-core';
import { describe, expect, it } from 'vitest';

// Internal module, deliberately not part of the public barrel: report assembly
// takes expected commitment fields as arguments and must not be an entry point.
import { assembleReport } from '../src/report.js';

const OWNER = `0x${'11'.repeat(20)}` as const;
const SIGNER = `0x${'22'.repeat(20)}` as const;
const content = parseMemoryContent({ text: 'report shape', format: 'text.v0' });
const bytes = canonicalBytes(content);

function entry(overrides: Partial<Commitment> = {}): Commitment {
  return {
    owner: OWNER,
    contentHash: contentHash(content),
    cidDigest: cidDigest(bytes),
    signer: SIGNER,
    blockHeight: 99n,
    op: 0,
    prev: ZERO_BYTES32,
    ...overrides,
  };
}

describe('assembleReport — wire shape', () => {
  it('is JSON-safe: blockHeight is a decimal string and no bigint leaks', () => {
    const commitment = entry();
    const report = assembleReport({
      hash: commitmentHash(commitment),
      commitment,
      replacedBy: ZERO_BYTES32,
      bytes,
      chainDeep: true,
      chainActive: true,
      registry: `0x${'55'.repeat(20)}`,
      chainId: 84532,
    });

    expect(report.blockHeight).toBe('99');
    expect(report.replacedBy).toBeNull();
    expect(JSON.parse(JSON.stringify(report))).toMatchObject({
      schema: 'menhir-verify/1',
      commitmentHash: commitmentHash(commitment),
      verdict: 'verified',
    });
  });

  it('rejects an invalid op with CHAIN_MISMATCH', () => {
    const commitment = entry({ op: 2 as 0 | 1 });
    expect(() =>
      assembleReport({
        hash: commitmentHash(commitment),
        commitment,
        replacedBy: ZERO_BYTES32,
        bytes,
        chainDeep: true,
        chainActive: true,
      }),
    ).toThrowError(expect.objectContaining({ code: 'CHAIN_MISMATCH' }));
  });

  it('rejects a struct that cannot be ABI-encoded with CHAIN_MISMATCH', () => {
    const commitment = entry({ blockHeight: 'not-a-bigint' as unknown as bigint });
    expect(() =>
      assembleReport({
        hash: commitmentHash(entry()),
        commitment,
        replacedBy: ZERO_BYTES32,
        bytes,
        chainDeep: true,
        chainActive: true,
      }),
    ).toThrowError(expect.objectContaining({ code: 'CHAIN_MISMATCH' }));
  });
});
