/**
 * Browser-safety smoke.
 *
 * Compiled by `pnpm check:browser` with `--lib es2022,dom` and no Node types.
 * It imports the package root barrel: if any reachable module imports a Node
 * builtin, this file fails to compile.
 */
import * as root from '../src/index.js';

export const rootExportCount = Object.keys(root).length;

export type PublicSurface = [
  typeof root.makeReader,
  typeof root.verifyBytes,
  typeof root.verifyByCid,
  typeof root.fetchFromGateway,
  typeof root.VerifyError,
];
