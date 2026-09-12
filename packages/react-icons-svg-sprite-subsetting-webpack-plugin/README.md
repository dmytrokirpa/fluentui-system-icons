# @fluentui/react-icons-svg-sprite-subsetting-webpack-plugin

> **⚠️ 0.x** — this package is in early development and follows [zero-based major semver](https://0ver.org/).
> Breaking changes may occur in minor releases until 1.0.

Webpack **and rspack** plugin that optimizes the `@fluentui/react-icons/svg-sprite/*` entrypoints.

It supports two modes, plus optional **named sprite groups**:

- **`atomic` (default):** subsets each emitted sprite asset (`atoms/svg-sprite/*.svg`) to only the `<symbol>` IDs that are actually used.
- **`merged`:** emits a single merged sprite asset containing only the used `<symbol>` IDs, and rewrites internal sprite imports so all icons reference the merged file.
- **named groups:** when the atomic loader appends `?sprite=<group>` (or you set `sprites`), the plugin emits one merged sprite per group. Inlined groups are written into the HTML body; deferred groups are same-origin files the browser fetches on first `<use href>`.

Sprite URLs are generated modules (`__webpack_public_path__ + filename`) — there is no webpack `RuntimeModule`, which is what makes rspack parity possible.

## Install

```sh
npm i -D @fluentui/react-icons-svg-sprite-subsetting-webpack-plugin
```

## Usage

```js
const {
  default: FluentUIReactIconsSvgSpriteSubsettingPlugin,
} = require('@fluentui/react-icons-svg-sprite-subsetting-webpack-plugin');

module.exports = {
  // ...
  plugins: [
    new FluentUIReactIconsSvgSpriteSubsettingPlugin({
      mode: 'atomic', // or 'merged'
      generateSpritesManifest: false,
      injectSpritesInTemplates: false,
      // mergedSpriteFilename: 'fluentui-react-icons.[contenthash].svg'
    }),
  ],
};
```

The same constructor works on `@rspack/core` `>= 2.0`. HTML injection uses `html-webpack-plugin` or rspack's `HtmlRspackPlugin`.

### Named groups (split sprites)

Pair with the atomic loader's `variantRules` / `?sprite=` query. Existing `mode` / `mergedSpriteFilename` / `injectSpritesInTemplates` options are unchanged for builds that do not use groups.

```js
new FluentUIReactIconsSvgSpriteSubsettingPlugin({
  sprites: {
    critical: { inline: true },
    '*': { inline: false, prefetch: true },
  },
  sharedSymbols: 'duplicate', // default; 'hoist' drops inlined symbols from other groups
});
```

Imports without a `sprite` query land in the `main` group. Sprites must stay **same-origin** — browsers block cross-origin `<use href>`.

## Options

You can pass a hash of configuration options to the plugin. Allowed values are as follows:

| Name                           | Type                     | Default       | Description                                                                                                                                                                                                                                                                                                                               |
| :----------------------------- | :----------------------- | :------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`mode`**                     | `{'atomic'\|'merged'}`   | `'atomic'`    | `'atomic'` subsets each emitted sprite asset (`atoms/svg-sprite/*.svg`) to only used symbols. `'merged'` emits a single merged sprite and rewrites sprite imports to it.                                                                                                                                                                  |
| **`mergedSpriteFilename`**     | `{String}`               | `undefined`   | The filename for the merged sprite asset. Only valid when `mode` is `'merged'`. Supports `[fullhash]` and `[contenthash]` placeholders.                                                                                                                                                                                                   |
| **`forceEnableUsedExports`**   | `{Boolean}`              | `true`        | If `true`, automatically enables `optimization.usedExports` when it is not already set in your webpack config.                                                                                                                                                                                                                            |
| **`generateSpritesManifest`**  | `{Boolean}`              | `false`       | If `true`, emits a `sprites-manifest.json` file containing entrypoint-level sprite usage information.                                                                                                                                                                                                                                     |
| **`injectSpritesInTemplates`** | `{Boolean\|Object}`      | `false`       | Controls HTML injection of sprites via `html-webpack-plugin` or rspack's `HtmlRspackPlugin`. `false` disables injection. `true` is shorthand for `{ mode: 'inline' }`. `{ mode: 'inline' }` injects a merged inline `<svg>` at the start of `<body>`. `{ mode: 'reference' }` injects `<link rel="preload">` tags for used sprite assets. |
| **`sprites`**                  | `{Object}`               | `undefined`   | Per-group emission. Keys are group names (`critical`, `grid`, `*`). Each value may set `inline`, `prefetch`, and `filename` (`[name]`, `[contenthash]`, `[fullhash]`).                                                                                                                                                                    |
| **`sharedSymbols`**            | `{'duplicate'\|'hoist'}` | `'duplicate'` | When the same symbol is used in two groups, `'duplicate'` ships it in both (and warns). `'hoist'` drops it from non-inlined groups when it already lives in an inlined group.                                                                                                                                                             |

## Notes

- For best results, run Webpack in production mode (or enable `optimization.usedExports`) so the plugin can detect which icon exports are used.
- `injectSpritesInTemplates` requires `html-webpack-plugin` (webpack) or `HtmlRspackPlugin` (rspack) to be installed and configured.
- Existing options are unchanged. Named groups and rspack support are additive.

## Contributing

For an in-depth look at the plugin's internal architecture, hook lifecycle, used-exports analysis, and runtime modules, see [SPEC.md](./SPEC.md).
