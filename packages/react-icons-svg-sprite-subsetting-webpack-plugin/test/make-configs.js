// @ts-check
const { readFileSync } = require('fs');
const { join, resolve } = require('path');

const { default: FluentUIReactIconsSvgSpriteSubsettingPlugin } = require('../lib/');

/**
 * @typedef {object} BundlerAdapter
 * @property {'webpack' | 'rspack'} name
 * @property {(new (...args: any[]) => any) | null} HtmlPlugin
 */

/**
 * @param {BundlerAdapter} adapter
 * @returns {import('webpack').Configuration}
 */
function createConfig(adapter) {
  const isMerged = process.env.SVG_SPRITE_MODE === 'merged';
  const injectMode = process.env.SVG_SPRITE_INJECT;
  const generateManifest = process.env.SVG_SPRITE_MANIFEST === '1';
  const mergedSpriteFilename = process.env.SVG_SPRITE_MERGED_FILENAME;
  const isGroups = process.env.SVG_SPRITE_GROUPS === '1';
  // A group alongside plain (ungrouped) sprite imports, with no `sprites` option.
  const isMixedGroups = process.env.SVG_SPRITE_GROUPS === 'mixed';
  const modeName = isGroups ? 'groups' : isMixedGroups ? 'groups-mixed' : isMerged ? 'merged' : 'atomic';
  const entryName = isGroups ? 'groups' : isMixedGroups ? 'groupsMixed' : isMerged ? 'merged' : 'atomic';
  const hasHtmlInjection = injectMode === 'inline' || injectMode === 'reference' || isGroups;

  const distName = `${adapter.name}-${modeName}${injectMode ? `-${injectMode}` : ''}${
    generateManifest ? '-manifest' : ''
  }`;

  console.log(`Running svg-sprite subsetting test (${adapter.name}) in ${modeName} mode`);

  return {
    context: __dirname,
    mode: 'production',
    resolve: {
      // Directory alias (not per-file) so `?sprite=` on the import is preserved.
      alias: {
        '@fluentui/react-icons/svg-sprite': resolve(__dirname, '__mock__/react-icons/lib/atoms/svg-sprite'),
      },
    },
    module: {
      rules: [
        {
          test: /\.svg$/,
          type: 'asset/resource',
          generator: {
            filename: `[name]-[contenthash][ext]`,
          },
        },
      ],
    },
    entry: isGroups
      ? { groups: './src/groups.js' }
      : isMixedGroups
        ? { groupsMixed: './src/groups-mixed.js' }
        : isMerged
          ? { merged: './src/merged.js' }
          : { atomic: './src/atomic.js' },
    output: {
      path: resolve(__dirname, 'dist', distName),
      filename: '[name].js',
      clean: true,
    },
    plugins: [
      new FluentUIReactIconsSvgSpriteSubsettingPlugin(
        isGroups
          ? {
              mode: 'merged',
              sprites: {
                critical: { inline: true },
                grid: { inline: false, prefetch: true, filename: 'grid.[contenthash].sprite.svg' },
              },
              injectSpritesInTemplates: true,
            }
          : isMixedGroups
            ? {}
            : {
              mode: isMerged ? 'merged' : 'atomic',
              mergedSpriteFilename: isMerged ? mergedSpriteFilename || 'fluentui-react-icons.svg' : undefined,
              generateSpritesManifest: generateManifest,
              injectSpritesInTemplates: hasHtmlInjection ? { mode: injectMode || 'inline' } : false,
            },
      ),
      ...(hasHtmlInjection && adapter.HtmlPlugin
        ? [
            new adapter.HtmlPlugin({
              filename: 'index.html',
              chunks: [entryName],
            }),
          ]
        : []),
      {
        apply(/** @type {import('webpack').Compiler} */ compiler) {
          compiler.hooks.afterEmit.tap('test-svg-sprite-subsetting', (compilation) => {
            const outDir = compilation.outputOptions.path || resolve(__dirname, 'dist');
            const svgAssets = compilation
              .getAssets()
              .map((a) => a.name)
              .filter((name) => name.endsWith('.svg'))
              .map((name) => ({ name, source: readFileSync(join(outDir, name), 'utf8') }));

            if (isMixedGroups) {
              // A grouped import must not stop the ungrouped ones from being subset, and it
              // must not produce a merged sprite for the default group that nothing loads.
              const critical = svgAssets.find((a) => /^critical\.[a-f0-9]+\.sprite\.svg$/.test(a.name));
              if (!critical) {
                throw new Error(`[${adapter.name}/groups-mixed] critical sprite was not emitted`);
              }
              if (!critical.source.includes('id="BackpackFilled"')) {
                throw new Error(`[${adapter.name}/groups-mixed] critical sprite missing BackpackFilled`);
              }
              const calculator = svgAssets.find((a) => a.name.startsWith('calculator-'));
              if (!calculator) {
                throw new Error(`[${adapter.name}/groups-mixed] ungrouped calculator sprite was not emitted`);
              }
              if (calculator.source.includes('id="CalculatorRegular"')) {
                throw new Error(
                  `[${adapter.name}/groups-mixed] ungrouped sprite was not subset to the used symbols`,
                );
              }
              const orphan = svgAssets.find((a) => a.name === 'fluentui-react-icons.svg');
              if (orphan) {
                throw new Error(`[${adapter.name}/groups-mixed] emitted an unreferenced merged sprite`);
              }
              const js = readFileSync(join(outDir, 'groupsMixed.js'), 'utf8');
              if (!js.includes(critical.name)) {
                throw new Error(`[${adapter.name}/groups-mixed] bundle does not reference the critical sprite URL`);
              }
              console.log(`  ✓ ${adapter.name}/groups-mixed: all assertions passed`);
              return;
            }

            if (isGroups) {
              const html = readFileSync(join(outDir, 'index.html'), 'utf8');
              if (!html.includes('id="BackpackFilled"')) {
                throw new Error(`[${adapter.name}/groups] critical sprite was not inlined in HTML`);
              }
              const grid = svgAssets.find((a) => /^grid\.[a-f0-9]+\.sprite\.svg$/.test(a.name));
              if (!grid) {
                throw new Error(`[${adapter.name}/groups] deferred grid sprite was not emitted`);
              }
              if (!grid.source.includes('id="CalculatorFilled"')) {
                throw new Error(`[${adapter.name}/groups] grid sprite missing CalculatorFilled`);
              }
              if (grid.source.includes('id="BackpackFilled"')) {
                throw new Error(`[${adapter.name}/groups] grid sprite should not contain the critical icon`);
              }
              if (!html.includes('rel="prefetch"') || !html.includes(grid.name)) {
                throw new Error(`[${adapter.name}/groups] missing prefetch link for the grid sprite`);
              }
              const js = readFileSync(join(outDir, 'groups.js'), 'utf8');
              if (!js.includes(grid.name)) {
                throw new Error(`[${adapter.name}/groups] bundle does not reference the grid sprite URL`);
              }
              console.log(`  ✓ ${adapter.name}/groups: all assertions passed`);
              return;
            }

            const mergedFilenamePattern = (mergedSpriteFilename || 'fluentui-react-icons.svg').replace(/\./g, '\\.');
            const mergedFilenameRegex = new RegExp(
              `^${mergedFilenamePattern.replace(/\[contenthash\]/g, '[a-f0-9]+').replace(/\[fullhash\]/g, '[a-f0-9]+')}$`,
            );

            if (isMerged) {
              const merged = svgAssets.find((a) => mergedFilenameRegex.test(a.name));
              if (!merged) {
                throw new Error(`[${adapter.name}] Merged sprite asset was not emitted`);
              }
              if (!merged.source.includes('id="BackpackFilled"') || !merged.source.includes('id="CalculatorFilled"')) {
                throw new Error(`[${adapter.name}] Merged sprite does not contain required symbols`);
              }
              if (merged.source.includes('id="BackpackRegular"')) {
                throw new Error(`[${adapter.name}] Merged sprite still contains unused symbols`);
              }
              const atomicSprites = svgAssets.filter(
                (a) => a.name.startsWith('backpack-') || a.name.startsWith('calculator-'),
              );
              if (atomicSprites.length > 0) {
                throw new Error(
                  `[${adapter.name}] Atomic sprite assets should not be emitted in merged mode: ${atomicSprites
                    .map((a) => a.name)
                    .join(', ')}`,
                );
              }
            } else if (!hasHtmlInjection || injectMode !== 'inline') {
              const backpack = svgAssets.find((a) => a.name.startsWith('backpack-'));
              if (!backpack) {
                throw new Error(`[${adapter.name}] Backpack sprite asset was not emitted`);
              }
              if (!backpack.source.includes('id="BackpackFilled"')) {
                throw new Error(`[${adapter.name}] Backpack sprite is missing BackpackFilled symbol`);
              }
              if (
                backpack.source.includes('id="BackpackRegular"') ||
                backpack.source.includes('id="Backpack12Filled"')
              ) {
                throw new Error(`[${adapter.name}] Atomic sprite was not subset down to only used symbols`);
              }
            }

            if (generateManifest) {
              const manifestText = readFileSync(join(outDir, 'sprites-manifest.json'), 'utf8');
              const manifest = JSON.parse(manifestText);
              if (!manifest.atomic) {
                throw new Error(`[${adapter.name}] sprites-manifest.json missing atomic entrypoint`);
              }
              if (!Array.isArray(manifest.atomic.sprites) || manifest.atomic.sprites.length === 0) {
                throw new Error(`[${adapter.name}] sprites-manifest.json atomic sprites list missing`);
              }
            }

            if (hasHtmlInjection) {
              const html = readFileSync(join(outDir, 'index.html'), 'utf8');
              if (injectMode === 'inline') {
                if (!html.includes('<svg') || !html.includes('id="BackpackFilled"')) {
                  throw new Error(`[${adapter.name}] Inline sprite was not injected into HTML`);
                }
              }
              if (injectMode === 'reference') {
                if (!html.includes('rel="preload"') || !html.includes('.svg')) {
                  throw new Error(`[${adapter.name}] Reference preload links were not injected into HTML`);
                }
              }
            }

            console.log(`  ✓ ${adapter.name}/${entryName}: all assertions passed`);
          });
        },
      },
    ],
  };
}

module.exports = { createConfig };
