# @fluentui/react-icons-tooling-core

Shared, bundler-agnostic core for the Fluent UI react-icons **webpack / rspack** tooling:

- [`@fluentui/react-icons-atomic-webpack-loader`](../react-icons-atomic-webpack-loader)
- [`@fluentui/react-icons-font-subsetting-webpack-plugin`](../react-icons-font-subsetting-webpack-plugin)
- [`@fluentui/react-icons-svg-sprite-subsetting-webpack-plugin`](../react-icons-svg-sprite-subsetting-webpack-plugin)

This package has **no bundler imports**. Webpack and rspack reach it through the three packages above. Other bundlers (Vite, Rollup, esbuild) are out of scope.

## What it contains

| Folder           | Responsibility                                                  |
| ---------------- | --------------------------------------------------------------- |
| `rewrite/`       | `transformSource` + module descriptors (atomic path rewrite)    |
| `variants/`      | `variantRules` matching, `?variant=` / `?sprite=` query parsing |
| `fonts/`         | codepoint tables + `subsetFontAsset`                            |
| `sprites/`       | extract / subset / merge / group symbols; HTML inject helpers   |
| `bundler-api.ts` | hand-maintained webpack/rspack surface used by the plugins      |

## One compilation, three delivery modes

```
Toolbar.tsx     -> svg-sprite/*?sprite=critical -> critical.sprite.svg (inlined in index.html)
routes/grid/*   -> svg-sprite/*?sprite=grid     -> grid.[hash].sprite.svg (fetched with the lazy chunk)
Hero.tsx        -> svg/*                        -> inline JS
(alt) routes/grid/* -> fonts/*                  -> FluentSystemIcons-*.woff2 (subset)
```

Existing plugin and loader **options are unchanged**. `variantRules`, `?variant=` / `?sprite=` queries, named sprite groups, and rspack sprite support are additive.

## Bench

See [`bench/README.md`](./bench/README.md) for the 35 / 100 / 300 icon profiles and the 60-second demo app.
