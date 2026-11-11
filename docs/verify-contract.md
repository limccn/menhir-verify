# menhir verify contract — v1

Normative specification of what `@limccn/menhir-verify` inputs, computes, and
promises. The report schema identifier is `menhir-verify/1`.

This document is about **verification**, not about writing, retrieval,
encryption, or identity. Those are defined elsewhere (menhir contract, M2).

## 1. Scope

The verifier answers exactly one question:

> Given bytes `B` and a commitment hash `H`, does `B` match the commitment
> recorded at `H` on the menhir registry, and is that commitment deep and
> active?

Inputs are `(H, B, optional expected owner, reader)`. The reader is the sole
source of expected values.

Out of scope, and never implied by a report:

- resolving `H` from a CID, an owner, or a gateway (callers may do this; the
  package does not);
- content correctness, truthfulness, or relevance;
- identity of the owner or signer beyond the address recorded on chain;
- encryption, access control, availability of the bytes.

## 2. Inputs

### 2.1 `verifyBytes`

| Input | Type | Rule |
|---|---|---|
| `reader` | `VerifyReader` | Must implement `getCommitment`, `isDeep`, `isActive`, `replacedByOf` |
| `commitmentHash` | `0x` + 64 hex | The commitment to check |
| `bytes` | `Uint8Array` | Non-empty; UTF-8 JSON that parses and validates as `MemoryContent` |
| `owner` | `0x` + 40 hex, optional | When present, must equal `commitment.owner` (case-insensitive) |

### 2.2 `verifyByCid`

Same, with `cid` (alphanumeric base32/base58) and `gateway` (`http(s)://` base
URL) replacing `bytes`, plus an optional `AbortSignal`. The CID determines the
bytes fetched; it does not determine the expected digest. A CID that does not
serve valid memory bytes fails the same way malformed `bytes` would.

### 2.3 Reader

```ts
interface VerifyReader {
  readonly registry?: Address;   // echoed into the report
  readonly chainId?: number;     // echoed into the report
  getCommitment(hash: Bytes32): Promise<Commitment>;
  isDeep(hash: Bytes32): Promise<boolean>;
  isActive(hash: Bytes32): Promise<boolean>;
  replacedByOf(hash: Bytes32): Promise<Bytes32>;
}
```

`makeReader(client, registry)` is the reference implementation (viem
`PublicClient`). A custom reader is allowed — for caching, batching, or a
different chain client — but it is trusted to report genuine chain state. The
`CHAIN_MISMATCH` guard (§4.4) catches a reader that returns a struct
inconsistent with `H`.

## 3. Computation

With `B` the supplied bytes and `C = getCommitment(H)`:

```
computedContentHash = keccak256(canonicalBytes(parseMemoryContent(JSON.parse(B))))
computedCidDigest   = sha256(B)
hashMatch           = C.contentHash == computedContentHash
digestMatch         = C.cidDigest   == computedCidDigest
chainDeep           = isDeep(H)
chainActive         = isActive(H)
anchored            = chainDeep && hashMatch && digestMatch
active              = chainActive && hashMatch && digestMatch
```

`canonicalBytes` and `parseMemoryContent` are `@limccn/menhir-core` functions —
the same ones the contract tooling and the write path use. Consequence:
`hashMatch` tolerates non-canonical JSON (key order, whitespace), while
`digestMatch` is byte-exact. Bytes that reproduce the same `MemoryContent` but
not the anchored byte string are `hashMatch: true, digestMatch: false`, not
`anchored`.

## 4. Outcomes

### 4.1 Verdict

| `verdict` | Condition |
|---|---|
| `content-mismatch` | `!hashMatch \|\| !digestMatch` |
| `retracted` | Both match, but `!chainActive` |
| `verified` | Both match and `chainActive` |

`verified` means: these exact bytes are the bytes anchored at `H`, and the
commitment is active. It says nothing about whether those bytes are true.

### 4.2 Report fields

The report is JSON-safe: `bigint` values never appear (`blockHeight` is a
decimal string), and `replacedBy` is `null` when the on-chain value is the zero
bytes32. `registry`/`chainId` are present only when the reader carries them.
Field-by-field schema is in the README; this document fixes their meaning.

### 4.3 Errors

| Code | When | Caller action |
|---|---|---|
| `INVALID_INPUT` | Malformed `commitmentHash`/`owner`, empty bytes, non-JSON bytes, schema-invalid content, malformed CID/gateway | Fix the input |
| `HASH_UNRESOLVED` | `isDeep(H)` is false | `H` is unknown on this registry — check address/chain |
| `CHAIN_MISMATCH` | Struct does not hash to `H`; malformed `contentHash`/`cidDigest`/`prev`/`owner`/`signer`; `op` not 0/1; `replacedByOf` not bytes32 | The RPC or registry address is inconsistent; do not trust the chain read |
| `OWNER_MISMATCH` | `owner` passed and `commitment.owner` differs | Check the commitment hash |
| `RPC_ERROR` | Any reader call rejects | Retry; check the endpoint |
| `FETCH_ERROR` | Gateway unreachable, non-2xx, `CONTENT_NOT_FOUND` | Retry; supply bytes directly |

### 4.4 `CHAIN_MISMATCH` as defense in depth

Before comparing digests, the verifier recomputes `commitmentHash(C)` over the
struct the reader returned and requires it to equal `H`. A normal registry
cannot produce a struct that violates this; a lying RPC, a wrong registry
address, or an ABI mismatch can. Treat `CHAIN_MISMATCH` as "the chain read is
not trustworthy", never as "content mismatch".

### 4.5 `DIGEST_MISMATCH` is not an error

Earlier design discussion used a `DIGEST_MISMATCH` code. In v1 it maps to a
**report outcome**, not an exception:

```
DIGEST_MISMATCH  →  digestMatch: false, anchored: false, verdict: 'content-mismatch'
```

A caller gets a report whenever the verification could be performed; errors are
reserved for cases where it could not.

## 5. Guarantees

1. **No caller-supplied expected values.** `verifyBytes` has no parameter that
   can set `contentHash`, `cidDigest`, `deep`, or `active`; the reader is the
   only source. `makeReader` closes over the registry address.
2. **No gateway authority.** The package never contacts hisaishi. A gateway in
   `verifyByCid` supplies bytes only.
3. **Deterministic comparison.** Given the same bytes and chain state, the
   report is identical; no clocks, randomness, or environment are read.
4. **Byte-exact anchoring claim.** `anchored`/`verified` are only true when
   `digestMatch` holds, i.e. the exact bytes were anchored.
5. **Chain state is re-checked.** `deep`/`active` are re-read, not trusted from
   a cache the caller cannot see (a custom reader may cache; that is its
   contract, not the package's).

## 6. Non-guarantees

- **Not truth.** A commitment can anchor false or malicious content. The
  signature attests authorship, not accuracy.
- **Not identity.** `signer` is an address; the package makes no claim about
  who controls it. ERC-8004 pointers in `meta.agent` are not read.
- **Not freshness beyond anchoring.** `blockHeight` is stamped when written and
  not compared to any wall clock.
- **Not availability.** `verifyByCid` fails if no gateway serves the bytes;
  `verifyBytes` sidesteps that but requires the caller to have the bytes.
- **Not finality policy.** `isDeep` is the registry's rule (M1: any anchored
  commitment). The verifier reports it; callers decide whether it suffices.
- **Not confidentiality.** M1 content is public. The verifier sees plaintext.

## 7. Versioning and compatibility

- `schema` is a literal `'menhir-verify/1'` on every report.
- Within v1: new optional report fields may be added; existing fields keep
  their meaning and type. New `VerifyError` codes may be added; callers must
  treat unknown codes as errors, not as verdicts.
- Breaking changes (renamed/removed fields, new required inputs, changed
  verdict semantics) bump the schema string and the package major version.
- The verdict vocabulary `verified | retracted | content-mismatch` is fixed for
  v1.

## 8. Reference deployment (M1)

| Item | Value |
|---|---|
| Network | Base Sepolia (`eip155:84532`) |
| Registry | `0xC85ed11d3065739F1829A114e420584bEC3FDFEF` |
| Contract | `MemoryRegistry` — no proxy, no upgrades |
| Depth rule | any anchored commitment is deep |
| Visibility | public; encryption is M2 |

A different registry address is a different trust domain. `commitmentHash`
covers the commitment struct but not the contract address or chain id, so the
same `H` can be legitimate on two registries; the report's `registry`/`chainId`
fields (when the reader carries them) are how a caller ties a verdict to the
deployment it checked. Pass both explicitly.
