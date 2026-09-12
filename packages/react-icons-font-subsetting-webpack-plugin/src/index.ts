import { dirname, resolve } from 'path';

import {
  REACT_ICONS_FONT_MODULE_IMPORT_PATTERN,
  codepointsToSubsetText,
  getFontAssetsAndCodepoints,
  getTargetFormat,
  subsetFontAsset,
} from './fonts';
import type { FontAssetCodepoints } from './fonts';
import type {
  BundlerCompilation,
  BundlerCompiler,
  BundlerModule,
  BundlerModuleGraph,
  BundlerNormalModule,
  BundlerPlugin,
  BundlerRawSource,
} from './bundler-api';
import { isNormalModule, isRspack } from './bundler-api';

export type * from './bundler-api';

const PLUGIN_NAME = 'FluentUIReactIconsFontSubsettingPlugin';

/** Separates "this module's icons are unknowable" from the benign "this module contributes nothing". */
const UNRESOLVABLE_NAMESPACE_IMPORT = Symbol('unresolvable-namespace-import');

interface FontPackageUsage {
  outputRoots: Set<string>;
  usedExports: Set<string>;
  hasUnresolvableNamespace: boolean;
}

export interface FluentUIReactIconsFontSubsettingPluginOptions {
  /**
   * What to do when font modules resolve from more than one installed copy of `@fluentui/react-icons`.
   *
   * `'warn'` (default) leaves all fonts un-subset, so every glyph still renders.
   * `'error'` fails the build instead.
   */
  onDuplicateInstances?: 'warn' | 'error';
}

export default class FluentUIReactIconsFontSubsettingPlugin implements BundlerPlugin {
  private readonly __onDuplicateInstances: 'warn' | 'error';

  constructor(options: FluentUIReactIconsFontSubsettingPluginOptions = {}) {
    this.__onDuplicateInstances = options.onDuplicateInstances ?? 'warn';
  }

  /**
   * Entry point for the bundler plugin that registers hooks to perform font subsetting for `@fluentui/react-icons`.
   *
   * This method is executed **once** by the bundler when the plugin is initialized during the compiler's
   * bootstrap phase. The internal logic hooked into `processAssets` is executed **once per compilation**
   * (whenever the bundler processes the module graph and prepares to output assets) during the
   * asset optimization stage.
   *
   * It analyzes the module graph to determine which specific icons are used from Fluent UI icon packages
   * and triggers font subsetting to remove unused glyphs from the final output assets.
   *
   * Works with both webpack 5 and rspack. All bundler internals are reached through `compiler.webpack`,
   * which rspack aliases to its own namespace, so neither bundler is imported at runtime.
   *
   * @param compiler - The webpack or rspack compiler instance.
   */
  apply(compiler: BundlerCompiler) {
    const { Compilation, sources } = compiler.webpack;

    compiler.hooks.compilation.tap(PLUGIN_NAME, (compilation) => {
      compilation.hooks.processAssets.tapPromise(
        { name: PLUGIN_NAME, stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE },
        async () => {
          const runtime = getRuntimeSpec(compiler, compilation);
          const packageUsages = new Map<string, FontPackageUsage>();

          for (const m of compilation.modules) {
            if (isFluentUIReactFontChunk(m)) {
              const icons = resolveUsedIconExports(m, compilation.moduleGraph, runtime);
              if (icons === null) {
                continue;
              }

              const outputRoot = resolve(dirname(m.resource), '../..');
              const packageRoot = dirname(outputRoot);
              const usage = packageUsages.get(packageRoot) ?? {
                outputRoots: new Set<string>(),
                usedExports: new Set<string>(),
                hasUnresolvableNamespace: false,
              };
              usage.outputRoots.add(outputRoot);

              if (icons === UNRESOLVABLE_NAMESPACE_IMPORT) {
                usage.hasUnresolvableNamespace = true;
              } else {
                for (const icon of icons) {
                  usage.usedExports.add(icon);
                }
              }

              packageUsages.set(packageRoot, usage);
            }
          }
          const optimizationPromises: Promise<void>[] = [];

          for (const [packageRoot, usage] of packageUsages) {
            if (!usage.hasUnresolvableNamespace) {
              continue;
            }

            compilation.warnings.push(
              new Error(
                `${PLUGIN_NAME}: "${packageRoot}" is reached through a namespace import (\`import * as ...\`) ` +
                  `whose icons cannot be determined — either the bundler does not expose ` +
                  `\`moduleGraph.getProvidedExports()\` (rspack <2.1.0), or \`optimization.providedExports\` is ` +
                  `disabled. Every font in this package was left un-subset, because subsetting from the ` +
                  `remaining imports alone would drop glyphs that are actually used. Named imports are ` +
                  `unaffected. Upgrade to rspack >=2.1.0 for full coverage.`,
              ),
            );
          }

          if (packageUsages.size > 1) {
            const message = new Error(
              `${PLUGIN_NAME}: font modules from more than one installed copy of "@fluentui/react-icons" were resolved, ` +
                `so font assets cannot be attributed safely. Fonts were left un-subset to avoid dropping ` +
                `glyphs. Participating copies: ${[...packageUsages.keys()].map((p) => `"${p}"`).join(', ')}. ` +
                `Collapse them onto one instance with ` +
                `bundler \`resolve.alias\` entries — note that this also binds every copy to a single React ` +
                `and Griffel instance.`,
            );

            if (this.__onDuplicateInstances === 'error') {
              compilation.errors.push(message);
            } else {
              compilation.warnings.push(message);
            }

            return;
          }

          for (const [packageRoot, usage] of packageUsages) {
            if (usage.hasUnresolvableNamespace) {
              continue;
            }

            const fontAssetsByName = new Map<string, FontAssetCodepoints>();
            for (const outputRoot of usage.outputRoots) {
              const fontAssets = await getFontAssetsAndCodepoints(outputRoot, compilation, compiler.context);
              for (const fontAsset of fontAssets) {
                fontAssetsByName.set(fontAsset.assetName, fontAsset);
              }
            }

            if (fontAssetsByName.size === 0) {
              // Loud failure: silently shipping an un-subset font is worse than a broken build.
              compilation.warnings.push(
                new Error(
                  `${PLUGIN_NAME}: found used icon fonts in "${packageRoot}" but could not map any font module ` +
                    `to an emitted asset. Fonts will NOT be subset. Ensure a \`type: 'asset'\` ` +
                    `(or 'asset/resource') module rule matches /\\.(ttf|woff2?)$/.`,
                ),
              );
              continue;
            }

            for (const { assetName, codepoints: codepointMap } of fontAssetsByName.values()) {
              optimizationPromises.push(
                optimizeFontAsset(codepointMap, usage.usedExports, compilation, assetName, sources.RawSource),
              );
            }
          }

          // IMPORTANT: actually await all subsetting work
          await Promise.all(optimizationPromises);
        },
      );
    });
  }
}

/**
 * Resolves the runtime to query used-exports information for.
 *
 * webpack accepts `undefined`, meaning "merged across all runtimes". rspack requires explicit
 * runtime names, and those are the names of the *runtime chunks* — which are only the entrypoint
 * names by coincidence. Any build that names its runtime chunk (`entry.runtime`,
 * `optimization.runtimeChunk`) makes the two diverge, and querying the wrong runtime reports every
 * module as unused, so nothing gets subset. The runtimes are therefore read off the chunks.
 */
function getRuntimeSpec(compiler: BundlerCompiler, compilation: BundlerCompilation): string[] | undefined {
  if (!isRspack(compiler)) {
    return undefined;
  }

  const runtimes = new Set<string>();
  for (const chunk of compilation.chunks) {
    const { runtime } = chunk;
    if (typeof runtime === 'string') {
      runtimes.add(runtime);
    } else if (runtime) {
      for (const name of runtime) {
        runtimes.add(name);
      }
    }
  }

  // Entrypoint names remain a last resort for the (unexpected) case of chunks without runtimes.
  return runtimes.size > 0 ? Array.from(runtimes) : Array.from(compilation.entrypoints.keys());
}

async function optimizeFontAsset(
  codepointMap: Record<string, number>,
  usedExports: Set<string>,
  compilation: BundlerCompilation,
  assetName: string,
  RawSource: BundlerRawSource,
) {
  const subsetText = codepointsToSubsetText(codepointMap, usedExports);

  const asset = compilation.getAsset(assetName);
  if (!asset) {
    return;
  }

  let source = asset.source.source();

  if (typeof source === 'string') {
    source = Buffer.from(source);
  }

  // rspack's `compilation.assets` is a read-only proxy, so writes must go through `updateAsset`.
  compilation.updateAsset(
    assetName,
    new RawSource(await subsetFontAsset(source, subsetText, getTargetFormat(assetName))),
  );
}

/**
 * Resolves the set of icon export names that are actually consumed from a font chunk module.
 *
 * Uses the bundler's `moduleGraph.getUsedExports()` which returns one of four shapes:
 *
 * | Return value             | Meaning                                                            | Action                                     |
 * | ------------------------ | ------------------------------------------------------------------ | ------------------------------------------ |
 * | `null`                   | `optimization.usedExports` is disabled — no usage info available   | Skip (cannot determine which glyphs to keep)|
 * | `false`                  | Module has zero consumers — nothing is imported from it            | Skip (nothing to subset)                   |
 * | `true`                   | All exports are consumed (e.g. `import * as ns from '...'`)       | Fall back to `getProvidedExports()` ¹       |
 * | `Set<string>`/`string[]` | Exact set of named exports that are consumed                      | Use directly for subsetting                |
 *
 * ¹ When all exports are marked as used we can still subset: `getProvidedExports()` tells us
 *   which exports this specific module **declares** (not the entire font), so we subset the font
 *   to exactly the glyphs this module provides.
 *
 *   This is **critical for atomic font imports** (e.g. `import * as XboxConsoleGroup from
 *   '@fluentui/react-icons/fonts/xbox-console'`) — each atomic module only provides a small icon
 *   group, so `getProvidedExports()` returns just those few icons, enabling proper subsetting even
 *   with namespace imports. Without this, namespace imports would skip subsetting entirely and ship
 *   the full unsubsetted font.
 *
 * Returns `null` when the module contributes no glyphs, and {@link UNRESOLVABLE_NAMESPACE_IMPORT}
 * when its glyphs exist but cannot be identified — the caller must then leave the whole package's
 * fonts alone, since dropping the module silently would subset those glyphs away.
 */
function resolveUsedIconExports(
  m: BundlerNormalModule,
  moduleGraph: BundlerModuleGraph,
  runtime: string[] | undefined,
): string[] | null | typeof UNRESOLVABLE_NAMESPACE_IMPORT {
  const usedModuleExports = moduleGraph.getUsedExports(m, runtime);

  if (usedModuleExports === null) {
    // No info on used exports (optimization.usedExports is disabled) - subsetting requires knowing exactly which exports are used.
    return null;
  }

  if (usedModuleExports === false) {
    // No exports are used from this module - nothing to subset.
    return null;
  }

  if (usedModuleExports === true) {
    // All exports are used (e.g. `import * as ns from '...'` or similar namespace import).
    // Retrieve statically-provided exports from the module graph so we can subset to exactly
    // the glyphs this module declares (rather than the full font or nothing).
    if (typeof moduleGraph.getProvidedExports !== 'function') {
      // rspack <2.1 has no such API; the glyphs are real but unknowable, so the caller must bail.
      return UNRESOLVABLE_NAMESPACE_IMPORT;
    }

    const providedExports = moduleGraph.getProvidedExports(m);
    if (providedExports === null || typeof providedExports === 'boolean') {
      // Provided exports not statically known (optimization.providedExports disabled).
      return UNRESOLVABLE_NAMESPACE_IMPORT;
    }
    return [...providedExports];
  }

  // usedModuleExports is a Set<string> (webpack) or string[] (rspack) with the exact named exports that are used.
  return Array.from(usedModuleExports);
}

function isFluentUIReactFontChunk(m: BundlerModule): m is BundlerNormalModule {
  if (!isNormalModule(m)) {
    return false;
  }

  const resource = m.resource;
  if (!resource) {
    return false;
  }

  // Cheap pre-filter before regex
  if (!resource.includes('react-icons')) {
    return false;
  }

  return REACT_ICONS_FONT_MODULE_IMPORT_PATTERN.test(resource);
}
