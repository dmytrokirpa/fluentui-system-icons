// @ts-check
import { dependencyChecks } from '../../eslint.config.base.mjs';

// Optional peers / HTML integrations required lazily at runtime so the public
// `.d.ts` stays usable with only one bundler installed.
export default [
  dependencyChecks({
    ignoredDependencies: ['html-webpack-plugin', 'html-rspack-plugin', '@rspack/core', 'webpack'],
  }),
];
