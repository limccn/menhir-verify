/** IPFS gateway transport. The gateway is a byte source, never an authority. */

import { VerifyError } from './errors.js';

export async function fetchFromGateway(
  gateway: string,
  cid: string,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (!/^[a-zA-Z0-9]+$/.test(cid)) {
    throw new VerifyError('INVALID_INPUT', {
      detail: 'CID must be alphanumeric (base32/base58)',
    });
  }
  if (!/^https?:\/\//i.test(gateway)) {
    throw new VerifyError('INVALID_INPUT', {
      detail: `gateway must be an http(s) URL: ${gateway}`,
    });
  }

  const url = `${gateway.replace(/\/+$/, '')}/${cid}`;
  let response: Response;
  try {
    response = await fetch(url, {
      signal: signal ?? null,
      credentials: 'omit',
      referrerPolicy: 'strict-origin-when-cross-origin',
    });
  } catch (error) {
    throw new VerifyError('FETCH_ERROR', { detail: `gateway fetch failed: ${url}`, cause: error });
  }

  if (!response.ok) {
    throw new VerifyError('FETCH_ERROR', {
      detail:
        response.status === 404
          ? `CONTENT_NOT_FOUND: ${cid}`
          : `gateway returned ${response.status}`,
    });
  }

  return new Uint8Array(await response.arrayBuffer());
}
