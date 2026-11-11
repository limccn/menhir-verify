import {
  canonicalBytes,
  cidDigest,
  commitmentHash,
  contentHash,
  parseMemoryContent,
  ZERO_BYTES32,
  type Commitment,
} from '@limccn/menhir-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicClient } from 'viem';

import {
  makeReader,
  verifyByCid,
  verifyBytes,
  type VerifyReader,
} from '../src/index.js';

const OWNER = `0x${'11'.repeat(20)}` as const;
const OTHER = `0x${'22'.repeat(20)}` as const;
const SIGNER = `0x${'33'.repeat(20)}` as const;
const REGISTRY = `0x${'55'.repeat(20)}` as const;
const SUCCESSOR = `0x${'77'.repeat(32)}` as const;

const content = parseMemoryContent({ text: 'the real memory', format: 'text.v0' });
const bytes = canonicalBytes(content);
const expectedContentHash = contentHash(content);
const expectedCidDigest = cidDigest(bytes);

function commitment(overrides: Partial<Commitment> = {}): Commitment {
  return {
    owner: OWNER,
    contentHash: expectedContentHash,
    cidDigest: expectedCidDigest,
    signer: SIGNER,
    blockHeight: 42n,
    op: 0,
    prev: ZERO_BYTES32,
    ...overrides,
  };
}

interface ReaderOptions {
  deep?: boolean;
  active?: boolean;
  replacedBy?: `0x${string}`;
  returned?: Commitment;
}

function readerFor(entry: Commitment, options: ReaderOptions = {}): VerifyReader {
  return {
    registry: REGISTRY,
    chainId: 84532,
    async getCommitment() {
      return options.returned ?? entry;
    },
    async isDeep() {
      return options.deep ?? true;
    },
    async isActive() {
      return options.active ?? true;
    },
    async replacedByOf() {
      return options.replacedBy ?? ZERO_BYTES32;
    },
  };
}

function hashOf(entry: Commitment): `0x${string}` {
  return commitmentHash(entry);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('verifyBytes — chain-derived expectations', () => {
  it('reports verified for canonical bytes and a live commitment', async () => {
    const entry = commitment();
    const report = await verifyBytes({
      reader: readerFor(entry),
      commitmentHash: hashOf(entry),
      bytes,
    });

    expect(report.schema).toBe('menhir-verify/1');
    expect(report.registry).toBe(REGISTRY);
    expect(report.chainId).toBe(84532);
    expect(report.hashMatch).toBe(true);
    expect(report.digestMatch).toBe(true);
    expect(report.anchored).toBe(true);
    expect(report.active).toBe(true);
    expect(report.verdict).toBe('verified');
    expect(report.bytesLength).toBe(bytes.length);
  });

  it('reports content-mismatch when different bytes are supplied', async () => {
    const entry = commitment();
    const substituted = canonicalBytes(
      parseMemoryContent({ text: 'substituted bytes', format: 'text.v0' }),
    );
    const report = await verifyBytes({
      reader: readerFor(entry),
      commitmentHash: hashOf(entry),
      bytes: substituted,
    });

    expect(report.hashMatch).toBe(false);
    expect(report.digestMatch).toBe(false);
    expect(report.anchored).toBe(false);
    expect(report.active).toBe(false);
    expect(report.verdict).toBe('content-mismatch');
  });

  it('distinguishes same content with non-canonical bytes (hashMatch, not digestMatch)', async () => {
    const entry = commitment();
    const nonCanonical = new TextEncoder().encode(
      JSON.stringify({ text: 'the real memory', format: 'text.v0' }, null, 2),
    );
    const report = await verifyBytes({
      reader: readerFor(entry),
      commitmentHash: hashOf(entry),
      bytes: nonCanonical,
    });

    expect(report.hashMatch).toBe(true);
    expect(report.digestMatch).toBe(false);
    expect(report.anchored).toBe(false);
    expect(report.verdict).toBe('content-mismatch');
  });

  it('reports retracted when the commitment is no longer active', async () => {
    const entry = commitment();
    const report = await verifyBytes({
      reader: readerFor(entry, { active: false }),
      commitmentHash: hashOf(entry),
      bytes,
    });

    expect(report.anchored).toBe(true);
    expect(report.active).toBe(false);
    expect(report.verdict).toBe('retracted');
  });

  it('rejects an unknown commitment with HASH_UNRESOLVED', async () => {
    const entry = commitment();
    await expect(
      verifyBytes({
        reader: readerFor(entry, { deep: false }),
        commitmentHash: hashOf(entry),
        bytes,
      }),
    ).rejects.toMatchObject({ code: 'HASH_UNRESOLVED' });
  });

  it('rejects an owner mismatch with expected/actual', async () => {
    const entry = commitment();
    await expect(
      verifyBytes({
        reader: readerFor(entry),
        commitmentHash: hashOf(entry),
        bytes,
        owner: OTHER,
      }),
    ).rejects.toMatchObject({
      code: 'OWNER_MISMATCH',
      expected: OTHER,
      actual: OWNER,
    });
  });

  it('rejects a struct that does not hash to the requested commitment', async () => {
    const entry = commitment();
    const returned = commitment({ owner: OTHER });
    await expect(
      verifyBytes({
        reader: readerFor(entry, { returned }),
        commitmentHash: hashOf(entry),
        bytes,
      }),
    ).rejects.toMatchObject({ code: 'CHAIN_MISMATCH' });
  });

  it('reports signer, op, prev and replacedBy', async () => {
    const entry = commitment({ op: 1, prev: `0x${'44'.repeat(32)}` });
    const report = await verifyBytes({
      reader: readerFor(entry, { replacedBy: SUCCESSOR }),
      commitmentHash: hashOf(entry),
      bytes,
    });

    expect(report.signer).toBe(SIGNER);
    expect(report.op).toBe(1);
    expect(report.prev).toBe(`0x${'44'.repeat(32)}`);
    expect(report.replacedBy).toBe(SUCCESSOR);
  });

  it('reports replacedBy as null for a zero successor', async () => {
    const entry = commitment();
    const report = await verifyBytes({
      reader: readerFor(entry),
      commitmentHash: hashOf(entry),
      bytes,
    });
    expect(report.replacedBy).toBeNull();
  });

  it('rejects malformed input with INVALID_INPUT', async () => {
    const entry = commitment();
    const reader = readerFor(entry);

    await expect(
      verifyBytes({ reader, commitmentHash: '0x1234' as `0x${string}`, bytes }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    await expect(
      verifyBytes({ reader, commitmentHash: hashOf(entry), bytes: new Uint8Array() }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    await expect(
      verifyBytes({
        reader,
        commitmentHash: hashOf(entry),
        bytes: new TextEncoder().encode('not json'),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    await expect(
      verifyBytes({
        reader,
        commitmentHash: hashOf(entry),
        bytes: new TextEncoder().encode('{"text":"","format":"text.v0"}'),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    await expect(
      verifyBytes({
        reader,
        commitmentHash: hashOf(entry),
        bytes,
        owner: '0xnot-an-address' as `0x${string}`,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('makeReader — RPC failures are typed', () => {
  it('wraps a readContract rejection in RPC_ERROR', async () => {
    const client = {
      chain: { id: 84532 },
      async readContract() {
        throw new Error('rpc down');
      },
    } as unknown as PublicClient;
    const reader = makeReader(client, REGISTRY);

    await expect(reader.isDeep(`0x${'11'.repeat(32)}`)).rejects.toMatchObject({
      code: 'RPC_ERROR',
    });
  });
});

describe('verifyByCid — gateway is transport only', () => {
  it('fetches the CID and verifies the bytes', async () => {
    const entry = commitment();
    const fetchSpy = vi.fn(async () =>
      new Response(bytes as unknown as BodyInit, { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const report = await verifyByCid({
      reader: readerFor(entry),
      commitmentHash: hashOf(entry),
      cid: 'bafkrei',
      gateway: 'https://gw.example.org/ipfs',
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://gw.example.org/ipfs/bafkrei',
      expect.anything(),
    );
    expect(report.verdict).toBe('verified');
  });

  it('maps a 404 to FETCH_ERROR with CONTENT_NOT_FOUND', async () => {
    const entry = commitment();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));

    await expect(
      verifyByCid({
        reader: readerFor(entry),
        commitmentHash: hashOf(entry),
        cid: 'bafkrei',
        gateway: 'https://gw.example.org/ipfs',
      }),
    ).rejects.toMatchObject({
      code: 'FETCH_ERROR',
      detail: expect.stringContaining('CONTENT_NOT_FOUND'),
    });
  });

  it('maps a transport rejection to FETCH_ERROR', async () => {
    const entry = commitment();
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }));

    await expect(
      verifyByCid({
        reader: readerFor(entry),
        commitmentHash: hashOf(entry),
        cid: 'bafkrei',
        gateway: 'https://gw.example.org/ipfs',
      }),
    ).rejects.toMatchObject({ code: 'FETCH_ERROR' });
  });
});
