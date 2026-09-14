# @fluentui/react-icons-atomic-webpack-loader

> **⚠️ 0.x** — this package is in early development and follows [zero-based major semver](https://0ver.org/).
> Breaking changes may occur in minor releases until 1.0.

Webpack loader that transforms barrel imports and re-exports from `@fluentui/react-icons` and `@fluentui/react-brand-icons` into atomic deep paths for better tree-shaking and smaller bundles.

## Before / After

```js
// Before — barrel import pulls in the entire icon set
import { AddFilled, bundleIcon, useIconContext } from '@fluentui/react-icons';
import { ProjectColor } from '@fluentui/react-brand-icons';
export { ArrowLeftRegular } from '@fluentui/react-icons';

// After — each reference resolves to a small, isolated module
import { AddFilled } from '@fluentui/react-icons/svg/add';
import { bundleIcon } from '@fluentui/react-icons/utils';
import { useIconContext } from '@fluentui/react-icons/providers';
import { ProjectColor } from '@fluentui/react-brand-icons/svg/project';
export { ArrowLeftRegular } from '@fluentui/react-icons/svg/arrow-left';
```

## Usage

Add the loader to your webpack config as an [`enforce: 'pre'`](https://webpack.js.org/configuration/module/#ruleenforce) rule so it runs on the original source before any other loaders:

NOTE: Unlike most loaders, this one should NOT exclude `node_modules`. It needs to process files inside `node_modules` as well to transform barrel imports from `@fluentui/react-icons` and `@fluentui/react-brand-icons` in your third-party dependencies. Files that don't reference a supported module are skipped via a fast pre-check, so there is no meaningful overhead.

The loader also works unchanged with [rspack](https://rspack.rs) (`>=2.0.0`) — the same rule shape applies, and every fixture in this package's test suite is verified against both bundlers. `webpack` and `@rspack/core` are declared as **optional** peer dependencies, so you only need to install the one you use.

```js
// webpack.config.js
module.exports = {
  module: {
    rules: [
      {
        test: /\.[mc]?[jt]sx?$/,
        enforce: 'pre',
        use: ['@fluentui/react-icons-atomic-webpack-loader'],
      },
      // … your other rules (babel-loader, ts-loader, etc.)
    ],
  },
};
```

If your existing rules exclude `node_modules`, add a separate rule to cover dependencies:

```js
module.exports = {
  module: {
    rules: [
      {
        test: /\.[mc]?[jt]sx?$/,
        include: /[\\/]node_modules[\\/]/,
        enforce: 'pre',
        use: ['@fluentui/react-icons-atomic-webpack-loader'],
      },
      // … your other rules (babel-loader, ts-loader, etc.)
    ],
  },
};
```

## Supported modules

| Module                        | Variants                     | Headless       | Notes                         |
| ----------------------------- | ---------------------------- | -------------- | ----------------------------- |
| `@fluentui/react-icons`       | `svg`, `fonts`, `svg-sprite` | `svg`, `fonts` | Has `/providers` and `/utils` |
| `@fluentui/react-brand-icons` | `svg`                        | `svg`          | Has `/utils`; no `/providers` |

> **Color icons are SVG-only.** Color variants (`*Color`) rely on gradients that cannot be represented in an icon font, so they ship only in the `svg` and `svg-sprite` builds — never `fonts`. The loader reroutes color imports off font variants automatically (see [Color icons](#color-icons) below).

## Options

| Option                | Type                                   | Default     | Description                                                                                                                      |
| --------------------- | -------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `iconVariant`         | `'svg'` \| `'fonts'` \| `'svg-sprite'` | `'svg'`     | Variant icons resolve to. Applied to every supported module unless a rule or import query overrides it.                          |
| `fallbackVariant`     | `'svg'` \| `'fonts'` \| `'svg-sprite'` | `undefined` | Variant used for a module that does not support `iconVariant` (see below).                                                       |
| `headless`            | `boolean`                              | `false`     | Resolve to the headless (Griffel-free) build where the module ships one.                                                         |
| `variantRules`        | `VariantRule[]`                        | `[]`        | Per-file variant / sprite-group selection. First match against `resourcePath` wins (`test` / `include` / `package` / `exclude`). |
| `allowDynamicImports` | `boolean`                              | `false`     | Atomize a narrow, statically-provable subset of dynamic `import()` barrels (see below).                                          |

### Variant resolution & `fallbackVariant`

`iconVariant` is applied to every supported module referenced in a file. Because not every module ships every variant (for example `@fluentui/react-brand-icons` only ships `svg`), the loader resolves the variant per module:

1. If the module supports `iconVariant`, it is used.
2. Otherwise, if `fallbackVariant` is set and supported by the module, it is used.
3. Otherwise, if `fallbackVariant` is set but also unsupported, the loader emits a warning and falls back to `svg`.
4. Otherwise (no `fallbackVariant`), the loader fails with a descriptive error.

Resolution is lazy and per file: only modules actually imported in a given file are checked, so a file that imports only `@fluentui/react-icons` never errors about brand icons.

```js
// Resolve system icons to fonts, but keep brand icons on svg (their only variant).
{
  loader: '@fluentui/react-icons-atomic-webpack-loader',
  options: {
    iconVariant: 'fonts',
    fallbackVariant: 'svg',
  },
}
```

### Color icons

Color variants (`*Color`, e.g. `AddCircleColor`) are **SVG-only** — their gradients cannot be represented in an icon font, so the `fonts` build ships no color glyphs. When a color icon is imported under a color-less variant (`iconVariant: 'fonts'`), the loader reroutes just that import to a color-capable variant, following the same precedence as above (constrained to `svg` / `svg-sprite`), and emits a warning:

1. If `iconVariant` is already color-capable (`svg` / `svg-sprite`), the color import is left on it — no reroute, no warning.
2. Otherwise, if `fallbackVariant` is set and color-capable, it is used (e.g. `svg-sprite`).
3. Otherwise the loader falls back to `svg`.

Rerouting is per specifier, so color and non-color icons in the same statement resolve independently:

```js
// iconVariant: 'fonts'
import { AddFilled, AddCircleColor } from '@fluentui/react-icons';
// →
import { AddFilled } from '@fluentui/react-icons/fonts/add';
import { AddCircleColor } from '@fluentui/react-icons/svg/add-circle';
```

> Color icons are deprecated. See the [user guidance](https://microsoft.github.io/fluentui-system-icons/?path=/docs/icons-user-guidance--docs#color-variants-deprecated).

### Using font icons

```js
{
  test: /\.[mc]?[jt]sx?$/,
  enforce: 'pre',
  use: [
    {
      loader: '@fluentui/react-icons-atomic-webpack-loader',
      options: {
        iconVariant: 'fonts',
      },
    },
  ],
}
```

This changes icon resolution from `@fluentui/react-icons/svg/*` to `@fluentui/react-icons/fonts/*`. Non-icon exports (`utils`, `providers`) are unaffected.

> Color icons have no font build and are rerouted to `svg` (or `svg-sprite`) automatically — see [Color icons](#color-icons).

### Using the headless API

```js
{
  loader: '@fluentui/react-icons-atomic-webpack-loader',
  options: {
    iconVariant: 'fonts',
    headless: true,
  },
}
```

With the example above:

| Import              | Resolves to                                |
| ------------------- | ------------------------------------------ |
| `AddFilled`         | `@fluentui/react-icons/headless/fonts/add` |
| `bundleIcon` (util) | `@fluentui/react-icons/headless/utils`     |
| `useIconContext`    | `@fluentui/react-icons/providers` (shared) |

Notes:

- **Best-effort per module:** a module without a headless build for the resolved variant degrades to its standard (Griffel) implementation with a warning rather than failing the build. This applies to headless `svg-sprite` (not generated yet).
- **Version requirement:** headless `@fluentui/react-brand-icons` requires `>= 2.0.206`. The loader rewrites imports statically and does not check the installed version, so an older brand-icons will fail to resolve the `/headless/*` entries at build time.
- **Context is shared:** `useIconContext` / `IconDirectionContextProvider` always resolve to `@fluentui/react-icons/providers` — it is framework-agnostic and reused by both APIs.
- **CSS is your responsibility:** the loader only rewrites component/utility imports. You must still import the headless CSS in your app entry point:
  ```js
  import '@fluentui/react-icons/headless/styles.css';
  // and, for font icons:
  import '@fluentui/react-icons/headless/fonts/styles.css';
  ```

### Using SVG sprite icons

```js
{
  test: /\.[mc]?[jt]sx?$/,
  enforce: 'pre',
  use: [
    {
      loader: '@fluentui/react-icons-atomic-webpack-loader',
      options: {
        iconVariant: 'svg-sprite',
      },
    },
  ],
}
```

This changes icon resolution from `@fluentui/react-icons/svg/*` to `@fluentui/react-icons/svg-sprite/*`. Non-icon exports (`utils`, `providers`) are unaffected.

## Mixing rendering modes and splitting sprites

No single rendering mode fits every surface: inline SVG keeps `primaryFill` and hover, fonts win on large grids, and sprites win when many icons share a critical path. The loader can now pick a mode **per file** (and a named sprite group) from the webpack/rspack config, with no source change.

Rules match the **file being transformed** (`resourcePath`), not where the webpack config lives. An app-level config can still target a specific package.

Resolution order for each import:

1. Opt-in import query (`?variant=` / `?sprite=` / `?headless=`)
2. First matching `variantRules` entry (`test` / `include` / `package` / `exclude` against `resourcePath`)
3. Global `iconVariant` / `headless`
4. `fallbackVariant`
5. `'svg'`

```js
{
  loader: '@fluentui/react-icons-atomic-webpack-loader',
  options: {
    iconVariant: 'svg', // app default (hero, etc.)
    variantRules: [
      // Files inside @myorg/app-nav — works from the app webpack config.
      // Resolves the package from the file being transformed, so yarn/pnpm
      // layouts and webpack's symlink realpath (packages/app-nav) still match.
      { package: '@myorg/app-nav', iconVariant: 'svg-sprite', sprite: 'critical' },
      { test: /routes\/grid/, iconVariant: 'fonts' },
    ],
  },
}
```

Prefer `package` over a path regex like `/@myorg\/app-nav/` when the webpack config is at the app: `test` / `include` / `exclude` treat `\` and `/` as the same separator, but a regex still misses workspace packages once webpack realpaths `node_modules/@myorg/app-nav` to `packages/app-nav`.

`package` resolves the dependency from the directory of the file being transformed, falling back to the package's entry point when its `exports` map does not expose `./package.json`, and to the `node_modules/<name>/` path as a last resort. A package that cannot be resolved from that directory at all simply never matches, so check the name if a rule appears to do nothing.

`sprite` names become asset filenames, so they may only contain letters, digits, `_` and `-`. A group set on a non-`svg-sprite` import is ignored with a warning.

Equivalent without `package` — pin the resolved directory in the config:

```js
const path = require('path');
const appNav = path.dirname(require.resolve('@myorg/app-nav/package.json'));

{
  loader: '@fluentui/react-icons-atomic-webpack-loader',
  options: {
    iconVariant: 'svg',
    variantRules: [{ include: appNav, iconVariant: 'svg-sprite', sprite: 'critical' }],
  },
}
```

You can also split webpack `module.rules` with `include: appNav` and different loader `options`; `sprite` still belongs on `variantRules` (or a `?sprite=` query) because it is not a global option.

The app-nav rewrite becomes `@fluentui/react-icons/svg-sprite/add?sprite=critical`. Pair this with `@fluentui/react-icons-svg-sprite-subsetting-webpack-plugin`'s `sprites` option so `critical` is inlined in `index.html` and a deferred group is a same-origin `<use href>` fetch.

The query is part of the module request, so an icon pulled into two groups is bundled twice (once per group) and its `<symbol>` ships in both sprites. Keep an icon in a single group unless the split is worth those bytes.

### Opt-in import queries

When a one-off import must diverge from the file's rule:

```ts
import { AddFilled } from '@fluentui/react-icons?variant=svg-sprite&sprite=critical';
```

TypeScript: add the optional shim

```ts
/// <reference types="@fluentui/react-icons-atomic-webpack-loader/query" />
```

or list the package in `compilerOptions.types`.

## How it works

The loader parses each module and rewrites import and re-export declarations that reference a supported module. Each named specifier is routed to an atomic subpath based on its name:

### Resolution flow

Each named specifier is resolved independently, so color and non-color icons — even within the same statement — can land on different variants.

```mermaid
flowchart TD
    A["Named specifier from a supported module"] --> B{"Icon name? ends in Regular / Filled / Light / Color"}
    B -->|"context / hook"| P["/providers"]
    B -->|"utility"| U["/utils"]
    B -->|"yes"| V{"Module supports iconVariant?"}

    V -->|"yes"| R["variant = iconVariant"]
    V -->|"no"| F{"fallbackVariant set?"}
    F -->|"no"| ERR["Error: import left untouched, set fallbackVariant"]
    F -->|"yes, supported"| R2["variant = fallbackVariant"]
    F -->|"yes, unsupported"| RS["variant = svg (warning)"]

    R --> C{"Color icon?"}
    R2 --> C
    RS --> C

    C -->|"no"| H{"headless requested and available for variant?"}
    C -->|"yes, already color-capable: svg / svg-sprite"| H
    C -->|"yes, color-less variant: fonts"| CC["reroute to first color-capable of iconVariant, fallbackVariant, svg (warning)"]
    CC --> H

    H -->|"yes"| HP["prefix with /headless"]
    H -->|"no / not available (warning)"| STD["standard build"]
    HP --> OUT["resolved atomic path"]
    STD --> OUT
```

> Steps marked "(warning)" emit a build warning — a best-effort degrade rather than a hard failure.

### `@fluentui/react-icons`

| Export type    | Example                                          | Resolved path                                                        |
| -------------- | ------------------------------------------------ | -------------------------------------------------------------------- |
| Icon component | `AddFilled`, `ArrowLeftRegular`                  | `@fluentui/react-icons/svg/add` (or `/fonts/add`, `/svg-sprite/add`) |
| Context / hook | `useIconContext`, `IconDirectionContextProvider` | `@fluentui/react-icons/providers`                                    |
| Utility        | `bundleIcon`, `createFluentIcon`                 | `@fluentui/react-icons/utils`                                        |

### `@fluentui/react-brand-icons`

| Export type    | Example                                   | Resolved path                             |
| -------------- | ----------------------------------------- | ----------------------------------------- |
| Icon component | `ProjectColor`, `CalendarTaskbar20Filled` | `@fluentui/react-brand-icons/svg/project` |
| Utility        | `bundleIcon`, `createFluentIcon`          | `@fluentui/react-brand-icons/utils`       |

Files that don't reference a supported module are passed through untouched (fast pre-check).

## Limitations

### Dynamic imports are not atomized

The loader only rewrites **static** `import` / `export … from` declarations. A dynamic `import()` of a barrel cannot be atomized, because the returned module-namespace object is a runtime value whose usage the loader cannot statically prove:

```js
// ⚠️ Not rewritten — the ENTIRE icon set is pulled into the async chunk.
const { AddFilled } = await import('@fluentui/react-icons');
React.lazy(() => import('@fluentui/react-icons'));
```

When it detects a dynamic import of a supported barrel, the loader emits a warning. Import the atomic path directly instead — then you lazy-load only the icons you use:

```js
// ✅ Only this icon lands in the async chunk.
const { AddFilled } = await import('@fluentui/react-icons/svg/add');
```

Alternatively, move the icons behind a local module that statically imports them; the loader atomizes that module, and only your lazy chunk pays for what it uses.

> The same applies to full-barrel subpaths (`@fluentui/react-icons/svg`, `@fluentui/react-icons/fonts`) — dynamically importing those also bundles the whole set. Always target a per-icon atomic path.

### Opt-in: `allowDynamicImports`

> **Prefer a dedicated module of static imports.** The most robust pattern is a
> small module that statically imports the icons you need and is itself lazy-loaded
> (`const { AddFilled } = await import('./lazy-icons')`). Static imports are
> atomized unconditionally, tree-shake predictably, and avoid every gotcha below.
> Reach for `allowDynamicImports` only when refactoring to that pattern isn't
> practical.

With `allowDynamicImports: true`, the loader additionally rewrites a **narrow,
statically-provable** subset of dynamic barrel imports into atomic ones. Only two
call-site shapes qualify — where the imported names are literals at the `import()`:

```js
// await + object destructure
const { AddFilled } = await import('@fluentui/react-icons');
// → const { AddFilled } = await import('@fluentui/react-icons/svg/add');

// .then + object-pattern callback param
import('@fluentui/react-icons').then(({ AddFilled }) => …);
// → import('@fluentui/react-icons/svg/add').then(({ AddFilled }) => …);
```

Names from the **same** atom are grouped into one import; names from **different**
atoms become a positional `Promise.all([...])`:

```js
const { AddFilled, ArrowLeftRegular } = await import('@fluentui/react-icons');
// →
const [{ AddFilled }, { ArrowLeftRegular }] = await Promise.all([
  import('@fluentui/react-icons/svg/add'),
  import('@fluentui/react-icons/svg/arrow-left'),
]);
```

It honors `iconVariant` / `fallbackVariant` / `headless` and per-name color
rerouting exactly like static imports.

#### Gotchas — what is **not** rewritten (left untouched, still warns)

- **Namespace binding**: `const ns = await import('@fluentui/react-icons')` — `ns`
  is a runtime object; usage isn't statically known, so the whole set ships.
- **`.then(m => m.AddFilled)`**: namespace parameter + member access — not a
  destructure, so the names aren't visible at the call site.
- **Rest / computed / default / nested patterns**: `{ AddFilled, ...rest }`,
  `{ [name]: icon }`, `{ AddFilled = fallback }`, `{ Add: { … } }`.
- **Non-literal specifiers**: `import(pkg)`, template interpolation, or a promise
  stored in a variable and `.then`-ed elsewhere.

For any of these the loader leaves your code as-is and emits the standard
"cannot be atomized" warning — the safe default.

> ⚠️ The `Promise.all` rewrite changes the emitted runtime structure (parallel
> chunk loading, positional destructuring). It's semantically equivalent for the
> supported shapes, but if you depend on the exact expression shape, prefer the
> dedicated-module pattern above.

## Requirements

- `webpack` >= 5
- `@fluentui/react-icons` >= 2 (with atomic subpath exports)
- `@fluentui/react-brand-icons` (with atomic subpath exports), if used
  - `>= 2.0.206` when using `headless: true` — earlier versions do not ship the `/headless/svg/*` and `/headless/utils` entries, so the loader's rewritten imports will fail to resolve.
