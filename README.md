# @limccn/menhir-verify

Verifier-only client for menhir commitments. Given content bytes and a
commitment hash, it answers one question:

> Do these bytes match the commitment that is anchored on chain?

Every expected value — `contentHash`, `cidDigest`, `owner`, `signer`, `op`,
`prev`, retraction state — is read from the registry's `getCommitment` /
`replacedByOf` / `isDeep` / `isActive`. The caller supplies bytes and chooses
an RPC endpoint; it cannot supply an expected digest. No hash function is
injectable.

This package is browser-safe ESM: it imports no Node built-ins and no wallet
code. Dependencies are `@limccn/menhir-core` and `viem`.

## Install

```bash
npm install @limccn/menhir-verify
```

Requires Node.js >= 24. Source, issues, and release notes:
[github.com/limccn/menhir-verify](https://github.com/limccn/menhir-verify).

## The trust invariant

```
expected digests  ← getCommitment(H)      (chain)
computed digests  ← the bytes you hold    (local)
verdict           ← compare the two
```

A gateway or indexer may tell you *which hash* to check (`H`); it can never
tell you *what the hash should be*. If a gateway lies about `H`, the verdict is
`HASH_UNRESOLVED` or `content-mismatch` — never a false `verified`.

## Usage — Node

```ts
import { createPublicClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import { makeReader, verifyBytes } from '@limccn/menhir-verify';

const reader = makeReader(
  createPublicClient({ chain: baseSepolia, transport: http('https://sepolia.base.org') }),
  '0xC85ed11d3065739F1829A114e420584bEC3FDFEF', // Base Sepolia registry, M1
);

const report = await verifyBytes({
  reader,
  commitmentHash: '0x…',   // the commitment to check
  bytes,                    // Uint8Array held by the caller
  owner: '0x…',             // optional: assert ownership too
});

if (report.verdict === 'verified') {
  // these bytes are anchored and not retracted
}
```

Fetch by CID instead of holding bytes:

```ts
import { verifyByCid } from '@limccn/menhir-verify';

const report = await verifyByCid({
  reader,
  commitmentHash: '0x…',
  cid: 'bafkrei…',
  gateway: 'https://ipfs.io/ipfs', // any CORS-enabled gateway
});
```

`verifyByCid` fetches first (the CID is caller-supplied), then runs the same
checks as `verifyBytes`. For an unknown commitment, prefer `verifyBytes`: it
reads the chain before touching any bytes, so you can avoid a fetch you do not
need.

## Usage — browser

`makeReader` accepts a viem `PublicClient`, which works in the browser with
`http()` or a custom transport. `verifyByCid` uses the global `fetch`; choose a
gateway that sends permissive CORS headers for your origin.

```ts
import { createPublicClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import { makeReader, verifyByCid } from '@limccn/menhir-verify';

const reader = makeReader(
  createPublicClient({ chain: baseSepolia, transport: http('https://sepolia.base.org') }),
  registry,
);

const report = await verifyByCid({
  reader,
  commitmentHash,
  cid,
  gateway: 'https://ipfs.io/ipfs',
});
```

## Report

`schema: "menhir-verify/1"` — bump only on a breaking change.

| Field | Meaning |
|---|---|
| `commitmentHash` | The `H` that was checked |
| `owner`, `signer`, `op`, `prev` | Commitment fields as stored on chain |
| `blockHeight` | Chain height stamped at anchoring; decimal string |
| `replacedBy` | Successor commitment hash, or `null` when none |
| `contentHash`, `cidDigest` | **Expected** values from `getCommitment(H)` |
| `computedContentHash`, `computedCidDigest` | Values recomputed over the bytes |
| `hashMatch` | Canonical content hash agrees — `keccak256(JCS(parse(bytes)))` |
| `digestMatch` | Byte-exact digest agrees — `sha256(bytes)` |
| `chainDeep` | `isDeep(H)` on chain |
| `chainActive` | `isActive(H)` on chain |
| `anchored` | `chainDeep && hashMatch && digestMatch` |
| `active` | `chainActive && hashMatch && digestMatch` |
| `bytesLength` | Size of the bytes that were checked |
| `verdict` | `verified` \| `retracted` \| `content-mismatch` |
| `registry`, `chainId` | Present when the reader carries them |

`verdict` is `content-mismatch` if either digest differs, else `retracted` if
the commitment is no longer active, else `verified`.

`hashMatch` canonicalizes first, so JSON key order and whitespace do not affect
it. `digestMatch` is byte-exact. The common split is
`hashMatch: true, digestMatch: false`: the same memory content, encoded
differently. That is not `anchored` — the anchored CID names specific bytes.

## Errors

A digest mismatch is **not** an error; it is a report outcome. `VerifyError`
covers failures to perform the verification:

| Code | Cause | What to do |
|---|---|---|
| `INVALID_INPUT` | Malformed hash/address, empty bytes, bytes not JSON, content fails schema validation | Fix the input |
| `HASH_UNRESOLVED` | `isDeep(H)` is false | Wrong `H`, wrong registry, or not anchored yet |
| `CHAIN_MISMATCH` | `getCommitment(H)` returned a struct that does not hash to `H`, or has an invalid field | Wrong registry address or an inconsistent RPC — do not trust the result |
| `OWNER_MISMATCH` | `commitment.owner` differs from the `owner` you passed | Wrong commitment for that owner |
| `RPC_ERROR` | A `readContract` call failed | Retry / check the endpoint |
| `FETCH_ERROR` | Gateway unreachable, non-2xx, or `CONTENT_NOT_FOUND` | Retry or use held bytes |

Every error carries `code`, `detail?`, and optionally `expected`/`actual`.

## What this does not prove

- **Anchored is not true.** `deep` means committed, not correct. The verifier
  attests provenance, not truthfulness.
- **Signer is not identity.** `signer` is the key that authored the
  commitment. Whether that key belongs to a particular agent or person is out
  of scope (ERC-8004 pointers are not read here).
- **Freshness is bounded by what was anchored.** `blockHeight` is stamped at
  write time, not verified against wall-clock time.
- **M1 is public and testnet.** Everything anchored is readable by anyone, and
  Base Sepolia has no economic finality. Encryption and mainnet are M2+.

Normative inputs, outputs, and non-guarantees:
[`docs/verify-contract.md`](./docs/verify-contract.md).

## License

Apache-2.0. See [LICENSE](./LICENSE).
