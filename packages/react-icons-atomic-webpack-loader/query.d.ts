/**
 * Optional TypeScript shim for opt-in import queries (`?variant=`, `?sprite=`).
 *
 * Add this package to `compilerOptions.types`, or triple-slash reference it:
 *
 * ```ts
 * /// <reference types="@fluentui/react-icons-atomic-webpack-loader/query" />
 * import { AddFilled } from '@fluentui/react-icons?variant=svg-sprite&sprite=critical';
 * ```
 */

declare module '@fluentui/react-icons?*' {
  export * from '@fluentui/react-icons';
}

declare module '@fluentui/react-brand-icons?*' {
  export * from '@fluentui/react-brand-icons';
}

declare module '@fluentui/react-icons/svg-sprite/*?*' {
  export * from '@fluentui/react-icons';
}

export {};
