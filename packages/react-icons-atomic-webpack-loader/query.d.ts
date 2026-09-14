/**
 * Optional TypeScript shim for opt-in import queries (`?variant=`, `?sprite=`).
 *
 * Add this package to `compilerOptions.types`, or triple-slash reference it:
 *
 * ```ts
 * /// <reference types="@fluentui/react-icons-atomic-webpack-loader/query" />
 * import { AddFilled } from '@fluentui/react-icons?variant=svg-sprite&sprite=critical';
 * ```
 *
 * This file must stay a script, not a module: a top-level `export` would turn the
 * declarations below into module augmentations, which cannot introduce a new module
 * name and would leave every query import as `TS2307`.
 *
 * An ambient module name may contain at most one `*`, so the queried form of an atomic
 * subpath (`@fluentui/react-icons/svg-sprite/add?sprite=critical`) cannot be covered
 * here. Put the query on the barrel import and let the loader rewrite it.
 */

declare module '@fluentui/react-icons?*' {
  export * from '@fluentui/react-icons';
}

declare module '@fluentui/react-brand-icons?*' {
  export * from '@fluentui/react-brand-icons';
}
