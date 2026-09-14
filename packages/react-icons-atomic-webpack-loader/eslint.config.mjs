// @ts-check
import { dependencyChecks } from '../../eslint.config.base.mjs';

// Both bundlers are optional peers that invoke the loader; neither is imported, not even for
// types, so the public `.d.ts` stays usable with only one of them installed.
export default [
  dependencyChecks({
    ignoredDependencies: ['@rspack/core', 'webpack'],
    // `query.d.ts` is a shipped ambient declaration, not a module that imports anything.
    ignoredFiles: ['{projectRoot}/query.d.ts'],
  }),
];
