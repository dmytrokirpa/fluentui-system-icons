# Bench and 60-second demo

Profiles at 35 / 100 / 300 icon kinds, on webpack and rspack:

| Config        | What it measures                                                           |
| ------------- | -------------------------------------------------------------------------- |
| `svg`         | single-mode inline SVG                                                     |
| `fonts`       | single-mode subsetted font                                                 |
| `svg-sprite`  | merged sprite                                                              |
| `mixed+split` | hero SVG + critical inlined sprite + deferred group (or fonts on the grid) |

Metrics collected by `node bench/run.js` (median not required for the smoke run):

- JS gzip (from webpack/rspack `assets` + `zlib`)
- critical-path bytes (HTML including inlined sprite + initial JS)
- request count (emitted initial assets)
- build wall-clock
- duplicated-symbol bytes (H4) when a shared icon is in two groups

FCP / LCP / Lighthouse and Playwright DOM-node counts are optional follow-up (`PLAYWRIGHT=1`); the harness always prints the byte/request/build-time rows that justify per-import selection (H3) and split sprites (H5).

## 60-second demo

```sh
yarn nx run react-icons-tooling-core:build
yarn nx run react-icons-atomic-webpack-loader:build
yarn nx run react-icons-svg-sprite-subsetting-webpack-plugin:build
node packages/react-icons-tooling-core/bench/run.js --bundler webpack --profile mixed
```

Then serve `packages/react-icons-tooling-core/bench/dist/webpack-mixed` and:

1. Toolbar uses the critical inlined sprite (hover fill).
2. Hero uses inline SVG (`primaryFill`).
3. Switching the grid rule from `fonts` to `{ iconVariant: 'svg-sprite', sprite: 'grid' }` fetches `grid.[hash].sprite.svg` only with the lazy route.

Zero option changes for existing users: `variantRules` / `sprites` are additive.
