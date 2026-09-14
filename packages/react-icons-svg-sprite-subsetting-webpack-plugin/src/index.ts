import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { Schema } from 'schema-utils/declarations/validate';
import { validate } from 'schema-utils';

import {
  ATOMS_SVG_SPRITE_DIR_PATTERN,
  DEFAULT_SPRITE_GROUP,
  REACT_ICONS_SVG_SPRITE_JS_MODULE_IMPORT_PATTERN,
  assertValidSpriteFilename,
  collectSortedIds,
  combineSpriteUsage,
  createContentHash,
  getExportNameToSymbolIdMap,
  getReferencedSpritePath,
  getUsedSymbolIds,
  groupSymbols,
  injectIntoBody,
  injectIntoHead,
  isValidSpriteGroupName,
  mergeSprites,
  parseSpriteGroupFromQuery,
  resolveSpriteFilename,
  resolveSpriteGroup,
  resourceQueryFromResource,
  getModuleResourceQuery,
  SPRITE_URL_PLACEHOLDER_PREFIX,
  spriteUrlPlaceholder,
  stripXmlDeclaration,
  subsetSpriteSvg,
} from './sprites';
import type { SpriteGroupOptions, SvgSpriteOptimizationMode } from './sprites';
import type {
  BundlerCompilation,
  BundlerCompiler,
  BundlerEntrypoint,
  BundlerModule,
  BundlerNormalModule,
  BundlerNormalModuleFactory,
  BundlerPlugin,
  BundlerResolveData,
} from './bundler-api';
import { isNormalModule, isRspack } from './bundler-api';

import optionsSchema from './options.schema.json';

const PLUGIN_NAME = 'FluentUIReactIconsSvgSpriteSubsettingPlugin';

const SPRITE_URL_LOADER = resolve(__dirname, 'runtime/spriteUrlLoader.js');
const SPRITE_URL_EMPTY = resolve(__dirname, 'runtime/empty.js');

type InjectSpritesInTemplatesMode = 'inline' | 'reference';
type InjectSpritesInTemplatesOptions = false | { mode: InjectSpritesInTemplatesMode };

export type { SvgSpriteOptimizationMode, SpriteGroupOptions };

export interface FluentUIReactIconsSvgSpriteSubsettingPluginOptions {
  /**
   * `atomic`: subset each imported sprite file.
   * `merged`: emit a single merged sprite and redirect sprite imports to it.
   */
  mode?: SvgSpriteOptimizationMode;

  /**
   * Output filename for merged sprite, relative to webpack output path.
   * Only used in `merged` mode (and as the default filename for the `main` group).
   */
  mergedSpriteFilename?: string;

  /**
   * When true, the plugin will set `optimization.usedExports = true` if it is unset.
   * This improves the chances that Webpack provides used-export info needed for subsetting.
   */
  forceEnableUsedExports?: boolean;

  /**
   * When true, emit sprites-manifest.json describing used symbols.
   */
  generateSpritesManifest?: boolean;

  /**
   * Optionally inject sprites into html-webpack-plugin / html-rspack-plugin templates.
   */
  injectSpritesInTemplates?: boolean | { mode: InjectSpritesInTemplatesMode };

  /**
   * Per-group emission and injection. Keys are group names from the loader's `sprite`
   * option / `?sprite=` query. `'*'` supplies defaults for groups not listed.
   *
   * When this option is set, or when any svg-sprite import carries a `?sprite=` query,
   * the plugin emits one merged sprite per group instead of a single app-wide sprite.
   *
   * An icon used from two groups is emitted in both (and warned about): every atom in a
   * group resolves to that group's single sprite URL, so a symbol cannot be served to one
   * group out of another group's file.
   */
  sprites?: Record<string, SpriteGroupOptions>;
}

interface NormalizedOptions {
  mode: SvgSpriteOptimizationMode;
  mergedSpriteFilename: string;
  forceEnableUsedExports: boolean;
  generateSpritesManifest: boolean;
  injectSpritesInTemplates: InjectSpritesInTemplatesOptions;
  sprites?: Record<string, SpriteGroupOptions>;
}

interface ResolvedGroupConfig {
  inline: boolean;
  prefetch: boolean;
  filename: string;
}

export default class FluentUIReactIconsSvgSpriteSubsettingPlugin implements BundlerPlugin {
  private options: NormalizedOptions;

  constructor(options: FluentUIReactIconsSvgSpriteSubsettingPluginOptions = {}) {
    validate(optionsSchema as Schema, options, { name: PLUGIN_NAME });
    this.options = normalizeOptions(options);
  }

  apply(compiler: BundlerCompiler) {
    if (this.options.forceEnableUsedExports) {
      compiler.options.optimization = compiler.options.optimization ?? {};
      if (compiler.options.optimization.usedExports === undefined) {
        compiler.options.optimization.usedExports = true;
      }
    }

    let currentCompilation: BundlerCompilation | undefined;
    let spriteGroupByRequest = new SpriteGroupRequestIndex();

    compiler.hooks.normalModuleFactory.tap(PLUGIN_NAME, (normalModuleFactory) => {
      normalModuleFactory.hooks.beforeResolve.tap(PLUGIN_NAME, (resolveData) => {
        recordSpriteGroupFromResolveRequest(resolveData, spriteGroupByRequest);
        if (!currentCompilation) {
          return;
        }
        rewriteSpriteSvgImport(resolveData, currentCompilation, this.options, spriteGroupByRequest);
      });
      // webpack only: rspack's JS parser is Rust-backed and mutating
      // HarmonyImportDependency.request from `parser.hooks.finish` panics.
      if (!isRspack(compiler)) {
        tapSpriteGroupQueryPropagation(normalModuleFactory);
      }
    });

    compiler.hooks.compilation.tap(PLUGIN_NAME, (compilation) => {
      currentCompilation = compilation;
      spriteGroupByRequest = new SpriteGroupRequestIndex();

      const { Compilation, sources } = compiler.webpack;
      const RawSource = sources.RawSource;

      let groupToResourceToIds: Map<string, Map<string, Set<string>>> | null = null;
      let groupToEntrypointNames: Map<string, Set<string>> | null = null;
      let entrypointToSpriteResourceToIds: Map<string, Map<string, Set<string>>> | null = null;
      let spriteResourceToAssetName: Map<string, string> | null = null;
      /** Groups whose atoms resolve through a generated URL module instead of their own `.svg` asset. */
      let urlModuleGroups: Set<string> | null = null;
      let spritesBuilt = false;
      const groupToAssetName = new Map<string, string>();
      const groupToSvg = new Map<string, string>();
      const injectedInlineGroups = new Set<string>();

      const ensureUsage = () => {
        if (!groupToResourceToIds || !entrypointToSpriteResourceToIds || !groupToEntrypointNames) {
          const collected = collectSpriteUsage(compilation);
          groupToResourceToIds = collected.groups;
          groupToEntrypointNames = collected.groupEntrypoints;
          entrypointToSpriteResourceToIds = collected.entrypoints;
        }
        if (!spriteResourceToAssetName) {
          spriteResourceToAssetName = getSpriteResourceToAssetName(compilation, compiler.context);
        }
        if (!urlModuleGroups) {
          urlModuleGroups = collectUrlModuleGroups(compilation);
        }
      };

      const ensureGroupSprites = () => {
        if (spritesBuilt) {
          return;
        }
        spritesBuilt = true;
        ensureUsage();
        const grouped = isGroupedMode(this.options, groupToResourceToIds ?? new Map());
        const { groups, duplicatedIds } = groupSymbols(groupToResourceToIds ?? new Map());

        if (grouped && duplicatedIds.length > 0) {
          compilation.warnings.push(
            new Error(
              `${PLUGIN_NAME}: ${duplicatedIds.length} icon(s) are used from more than one sprite group and are emitted in each of them. ` +
                `Duplicated ids: ${duplicatedIds.join(', ')}. Move the shared icons into a single group to avoid the extra bytes.`,
            ),
          );
        }

        const fullHash = compilation.fullHash ?? compilation.hash ?? '';

        for (const [group, resourceToIds] of groups) {
          // A group whose atoms still import their own `.svg` asset is served by atomic
          // subsetting; merging it here would emit a sprite nothing references.
          if (!urlModuleGroups?.has(group) || resourceToIds.size === 0) {
            continue;
          }

          const svg = mergeSprites(resourceToIds);
          groupToSvg.set(group, svg);

          const config = resolveGroupConfig(group, this.options);
          // An inlined group lives in the HTML document; the ungrouped merged path keeps
          // emitting a file as well, because that is what it has always done.
          if (config.inline && grouped) {
            continue;
          }

          const contentHash = createContentHash(compiler, compilation, svg);
          const assetName = resolveSpriteFilename(config.filename, {
            name: group,
            fullHash,
            contentHash,
          });
          groupToAssetName.set(group, assetName);
        }
      };

      const tapAssets = (stage: number, fn: () => void) => {
        if (typeof compilation.hooks.processAssets.tap === 'function') {
          compilation.hooks.processAssets.tap({ name: PLUGIN_NAME, stage }, fn);
        } else {
          compilation.hooks.processAssets.tapPromise({ name: PLUGIN_NAME, stage }, async () => {
            fn();
          });
        }
      };

      tapHtmlBeforeEmit(compiler, compilation, (html, data) => {
        if (this.options.injectSpritesInTemplates === false) {
          return html;
        }
        ensureUsage();
        ensureGroupSprites();

        const grouped = isGroupedMode(this.options, groupToResourceToIds ?? new Map());
        if (grouped) {
          return injectGroupedSprites(html, data, compilation, {
            groupToSvg,
            groupToAssetName,
            groupToEntrypointNames: groupToEntrypointNames ?? new Map(),
            options: this.options,
            injectedInlineGroups,
          });
        }

        return injectLegacySprites(
          html,
          data,
          compilation,
          this.options,
          entrypointToSpriteResourceToIds ?? new Map(),
          spriteResourceToAssetName ?? new Map(),
          groupToSvg.get(DEFAULT_SPRITE_GROUP) ?? null,
          groupToAssetName.get(DEFAULT_SPRITE_GROUP) ?? null,
        );
      });

      tapAssets(Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE, () => {
        ensureUsage();
        ensureGroupSprites();
        const grouped = isGroupedMode(this.options, groupToResourceToIds ?? new Map());

        for (const [group, svg] of groupToSvg) {
          const assetName = groupToAssetName.get(group);
          if (!assetName) continue;
          const source = new RawSource(svg);
          if (compilation.getAsset(assetName)) {
            compilation.updateAsset(assetName, source);
          } else {
            compilation.emitAsset(assetName, source);
          }
        }

        // Groups left out of the merged sprites above still reference their own `.svg`
        // assets, so they are subset in place. This keeps a build that mixes grouped and
        // ungrouped imports from shipping full sprites for the ungrouped ones.
        const atomicUsage = collectUngroupedUsage(groupToResourceToIds ?? new Map(), urlModuleGroups ?? new Set());
        subsetAtomicSprites(compilation, spriteResourceToAssetName ?? new Map(), atomicUsage, RawSource);

        if (this.options.generateSpritesManifest) {
          const manifest = buildSpritesManifest(
            entrypointToSpriteResourceToIds ?? new Map(),
            spriteResourceToAssetName ?? new Map(),
            groupToAssetName,
            grouped ? 'grouped' : this.options.mode,
          );
          compilation.emitAsset('sprites-manifest.json', new RawSource(JSON.stringify(manifest, null, 2)));
        }
      });

      const inlineStage = Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_INLINE ?? 700;
      tapAssets(inlineStage, () => {
        ensureGroupSprites();
        replaceSpriteUrlPlaceholders(compiler, compilation, groupToAssetName, PLUGIN_NAME);
        warnAboutUninjectedInlineGroups(compilation, groupToSvg, injectedInlineGroups, this.options);
      });
    });
  }
}

/**
 * Remembers which sprite group an atom request belongs to, keyed by request path and by
 * bare filename. The filename key is a fallback for bundlers that drop the issuer's
 * `?sprite=` query before `beforeResolve`; a key claimed by two different groups is
 * dropped rather than resolved arbitrarily.
 */
class SpriteGroupRequestIndex {
  private readonly byKey = new Map<string, string>();
  private readonly ambiguous = new Set<string>();

  set(key: string, group: string): void {
    if (this.ambiguous.has(key)) {
      return;
    }
    const existing = this.byKey.get(key);
    if (existing !== undefined && existing !== group) {
      this.byKey.delete(key);
      this.ambiguous.add(key);
      return;
    }
    this.byKey.set(key, group);
  }

  get(key: string | undefined): string | undefined {
    return key === undefined ? undefined : this.byKey.get(key);
  }
}

function recordSpriteGroupFromResolveRequest(
  resolveData: BundlerResolveData,
  spriteGroupByRequest: SpriteGroupRequestIndex,
): void {
  if (!resolveData || typeof resolveData.request !== 'string') {
    return;
  }
  const request = resolveData.request;
  if (request.includes('.svg')) {
    return;
  }
  const qIndex = request.indexOf('?');
  if (qIndex === -1) {
    return;
  }
  const group = parseSpriteGroupFromQuery(request.slice(qIndex));
  if (!group) {
    return;
  }
  const path = request.slice(0, qIndex);
  spriteGroupByRequest.set(path, group);
  const base = path
    .split(/[/\\]/)
    .pop()
    ?.replace(/\.(js|cjs|mjs|ts|tsx)$/i, '');
  if (base) {
    spriteGroupByRequest.set(base, group);
  }
}

function rewriteSpriteSvgImport(
  resolveData: BundlerResolveData,
  compilation: BundlerCompilation,
  options: NormalizedOptions,
  spriteGroupByRequest: SpriteGroupRequestIndex,
): void {
  if (!resolveData || typeof resolveData.request !== 'string') {
    return;
  }

  const qIndex = resolveData.request.indexOf('?');
  const requestPath = qIndex === -1 ? resolveData.request : resolveData.request.slice(0, qIndex);
  const requestQuery = qIndex === -1 ? '' : resolveData.request.slice(qIndex);
  if (!requestPath.endsWith('.svg')) {
    return;
  }
  if (typeof resolveData.context !== 'string' || !ATOMS_SVG_SPRITE_DIR_PATTERN.test(resolveData.context)) {
    return;
  }

  const issuerQuery = getIssuerResourceQuery(resolveData);
  const groupFromIssuer = parseSpriteGroupFromQuery(issuerQuery);
  const groupFromRequest = parseSpriteGroupFromQuery(requestQuery);
  const issuerPath = resolveData.contextInfo?.issuer?.split('?')[0];
  const svgBase = requestPath
    .split(/[/\\]/)
    .pop()
    ?.replace(/\.svg$/i, '');
  const issuerBase = issuerPath
    ?.split(/[/\\]/)
    .pop()
    ?.replace(/\.(js|cjs|mjs|ts|tsx)$/i, '');
  const groupFromMap =
    (issuerPath ? spriteGroupByRequest.get(issuerPath) : undefined) ||
    (issuerBase ? spriteGroupByRequest.get(issuerBase) : undefined) ||
    (svgBase ? spriteGroupByRequest.get(svgBase) : undefined);
  const group = groupFromIssuer ?? groupFromRequest ?? groupFromMap ?? DEFAULT_SPRITE_GROUP;
  const hasExplicitGroup = Boolean(groupFromIssuer || groupFromRequest || groupFromMap);

  const injectInline = options.injectSpritesInTemplates !== false && options.injectSpritesInTemplates.mode === 'inline';
  const rewriteAll = options.mode === 'merged' || injectInline || Boolean(options.sprites) || hasExplicitGroup;
  if (!rewriteAll) {
    return;
  }

  const config = resolveGroupConfig(group, options);
  const query = `group=${encodeURIComponent(group)}&inline=${config.inline ? '1' : '0'}`;
  resolveData.request = `!!${SPRITE_URL_LOADER}!${SPRITE_URL_EMPTY}?${query}`;
}

function tapSpriteGroupQueryPropagation(normalModuleFactory: BundlerNormalModuleFactory): void {
  const parserHook = (
    normalModuleFactory as BundlerNormalModuleFactory & {
      hooks: { parser?: { for(type: string): { tap(name: string, fn: (parser: SpriteParser) => void): void } } };
    }
  ).hooks.parser;
  if (!parserHook || typeof parserHook.for !== 'function') {
    return;
  }

  for (const type of ['javascript/auto', 'javascript/dynamic', 'javascript/esm']) {
    try {
      parserHook.for(type).tap(PLUGIN_NAME, (parser) => {
        parser.hooks.finish.tap(PLUGIN_NAME, () => {
          const module = parser.state.current || parser.state.module;
          if (!module) {
            return;
          }
          const group = parseSpriteGroupFromQuery(getModuleResourceQuery(module));
          if (!group) {
            return;
          }
          const deps = (module as { dependencies?: Array<{ request?: string }> }).dependencies;
          if (!deps) {
            return;
          }
          for (const dep of deps) {
            if (typeof dep.request !== 'string') {
              continue;
            }
            const requestPath = dep.request.split('?')[0];
            if (!requestPath.endsWith('.svg')) {
              continue;
            }
            if (dep.request.includes('sprite=')) {
              continue;
            }
            const sep = dep.request.includes('?') ? '&' : '?';
            dep.request += `${sep}sprite=${encodeURIComponent(group)}`;
          }
        });
      });
    } catch {
      // Parser type not registered on this bundler.
    }
  }
}

interface SpriteParser {
  hooks: { finish: { tap(name: string, fn: () => void): void } };
  state: { current?: BundlerModule; module?: BundlerModule };
}

function getIssuerResourceQuery(resolveData: BundlerResolveData): string {
  // Do not walk `compilation.modules` or `moduleGraph` here: rspack's module graph
  // is still being built during `beforeResolve` and those reads panic.
  return resourceQueryFromResource(resolveData.contextInfo?.issuer);
}

function isGroupedMode(options: NormalizedOptions, groups: Map<string, Map<string, Set<string>>>): boolean {
  if (options.sprites) {
    return true;
  }
  const names = Array.from(groups.keys());
  return names.some((name) => name !== DEFAULT_SPRITE_GROUP);
}

function resolveGroupConfig(group: string, options: NormalizedOptions): ResolvedGroupConfig {
  const specific = options.sprites?.[group];
  const wildcard = options.sprites?.['*'];
  const legacyInline =
    !options.sprites &&
    options.injectSpritesInTemplates !== false &&
    options.injectSpritesInTemplates.mode === 'inline' &&
    group === DEFAULT_SPRITE_GROUP;

  const filename =
    specific?.filename ??
    wildcard?.filename ??
    (group === DEFAULT_SPRITE_GROUP ? options.mergedSpriteFilename : `${group}.[contenthash].sprite.svg`);

  return {
    inline: specific?.inline ?? wildcard?.inline ?? legacyInline,
    prefetch: specific?.prefetch ?? wildcard?.prefetch ?? false,
    filename,
  };
}

function normalizeOptions(options: FluentUIReactIconsSvgSpriteSubsettingPluginOptions): NormalizedOptions {
  const mode = options.mode ?? 'atomic';
  const injectSpritesInTemplates = normalizeInjectSpritesInTemplates(options.injectSpritesInTemplates);
  const mergedSpriteFilenameProvided = options.mergedSpriteFilename !== undefined;

  if (mode === 'atomic' && mergedSpriteFilenameProvided) {
    throw new Error(`${PLUGIN_NAME}: mergedSpriteFilename is only valid when mode is "merged".`);
  }

  const mergedSpriteFilename = options.mergedSpriteFilename ?? 'fluentui-react-icons.svg';

  if (mode === 'merged') {
    const invalidToken = mergedSpriteFilename.match(/\[(?!fullhash|contenthash)[^\]]+\]/);
    if (invalidToken) {
      throw new Error(`${PLUGIN_NAME}: mergedSpriteFilename only supports [fullhash] and [contenthash] placeholders.`);
    }
  }
  if (options.sprites) {
    for (const [name, group] of Object.entries(options.sprites)) {
      if (name !== '*' && !isValidSpriteGroupName(name)) {
        throw new Error(
          `${PLUGIN_NAME}: invalid sprite group name "${name}". Group names become asset filenames, so they may only contain letters, digits, "_" and "-".`,
        );
      }
      if (group?.filename) {
        assertValidSpriteFilename(group.filename, PLUGIN_NAME);
      }
    }
  }

  return {
    mode,
    mergedSpriteFilename,
    forceEnableUsedExports: options.forceEnableUsedExports ?? true,
    generateSpritesManifest: options.generateSpritesManifest ?? false,
    injectSpritesInTemplates,
    sprites: options.sprites,
  };
}

function normalizeInjectSpritesInTemplates(
  input: FluentUIReactIconsSvgSpriteSubsettingPluginOptions['injectSpritesInTemplates'],
): InjectSpritesInTemplatesOptions {
  if (input === true) {
    return { mode: 'inline' };
  }
  if (!input) {
    return false;
  }
  return input;
}

function tapHtmlBeforeEmit(
  compiler: BundlerCompiler,
  compilation: BundlerCompilation,
  fn: (
    html: string,
    data: { html?: string; plugin?: { options?: { chunks?: 'all' | string[] } }; publicPath?: string },
  ) => string,
): void {
  const apply = (htmlOrData: unknown, extra?: unknown) => {
    if (typeof htmlOrData === 'string') {
      return fn(htmlOrData, (extra as { publicPath?: string }) ?? {});
    }
    if (htmlOrData && typeof htmlOrData === 'object' && 'html' in htmlOrData) {
      const data = htmlOrData as {
        html: string;
        plugin?: { options?: { chunks?: 'all' | string[] } };
        publicPath?: string;
      };
      data.html = fn(data.html, data);
      return data;
    }
    return htmlOrData;
  };

  if (isRspack(compiler)) {
    if (!compilerHasPlugin(compiler, 'HtmlRspackPlugin')) {
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const rspack = require('@rspack/core');
      const HtmlRspackPlugin = rspack.HtmlRspackPlugin;
      if (typeof HtmlRspackPlugin?.getCompilationHooks === 'function') {
        HtmlRspackPlugin.getCompilationHooks(compilation).beforeEmit.tap(PLUGIN_NAME, apply);
      }
    } catch {
      // optional
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const HtmlRspackPlugin = require('html-rspack-plugin');
      if (HtmlRspackPlugin?.getCompilationHooks) {
        HtmlRspackPlugin.getCompilationHooks(compilation).beforeEmit.tap(PLUGIN_NAME, apply);
      }
    } catch {
      // optional
    }
    return;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const HtmlWebpackPlugin = require('html-webpack-plugin');
    if (HtmlWebpackPlugin?.getHooks) {
      HtmlWebpackPlugin.getHooks(compilation).beforeEmit.tap(PLUGIN_NAME, apply);
    }
  } catch {
    // optional
  }
}

function compilerHasPlugin(compiler: BundlerCompiler, constructorName: string): boolean {
  const plugins = compiler.options?.plugins;
  if (!Array.isArray(plugins)) {
    return false;
  }
  return plugins.some((plugin) => plugin && typeof plugin === 'object' && plugin.constructor?.name === constructorName);
}

function getHtmlPublicPath(compilation: BundlerCompilation, data: { publicPath?: string }): string {
  if (typeof data.publicPath === 'string') {
    return data.publicPath === 'auto' ? '' : data.publicPath;
  }
  const outputPublicPath = compilation.outputOptions.publicPath;
  if (typeof outputPublicPath === 'string') {
    return outputPublicPath === 'auto' ? '' : outputPublicPath;
  }
  return '';
}

function getEntrypointNamesForHtml(compilation: BundlerCompilation, chunksOption?: 'all' | string[]): string[] {
  if (!chunksOption || chunksOption === 'all') {
    return Array.from(compilation.entrypoints.keys());
  }
  if (Array.isArray(chunksOption)) {
    return chunksOption.filter((name) => compilation.entrypoints.has(name));
  }
  return [];
}

function injectGroupedSprites(
  html: string,
  data: { plugin?: { options?: { chunks?: 'all' | string[] } }; publicPath?: string },
  compilation: BundlerCompilation,
  context: {
    groupToSvg: Map<string, string>;
    groupToAssetName: Map<string, string>;
    groupToEntrypointNames: Map<string, Set<string>>;
    options: NormalizedOptions;
    injectedInlineGroups: Set<string>;
  },
): string {
  const { groupToSvg, groupToAssetName, groupToEntrypointNames, options, injectedInlineGroups } = context;
  const publicPath = getHtmlPublicPath(compilation, data);
  // A multi-page build gets one template per entrypoint set, so only the groups this
  // page actually loads belong in it.
  const pageEntrypoints = new Set(getEntrypointNamesForHtml(compilation, data.plugin?.options?.chunks));
  const headParts: string[] = [];
  let next = html;

  for (const [group, svg] of groupToSvg) {
    if (!isGroupOnPage(groupToEntrypointNames.get(group), pageEntrypoints)) {
      continue;
    }
    const config = resolveGroupConfig(group, options);
    if (config.inline) {
      next = injectIntoBody(next, stripXmlDeclaration(svg).trim());
      injectedInlineGroups.add(group);
      continue;
    }
    const assetName = groupToAssetName.get(group);
    if (!assetName) continue;
    if (config.prefetch) {
      headParts.push(`<link rel="prefetch" as="image" type="image/svg+xml" href="${publicPath}${assetName}">`);
    }
  }

  if (headParts.length > 0) {
    next = injectIntoHead(next, headParts.join('\n'));
  }
  return next;
}

/** A group with no recorded entrypoints (nothing to attribute it to) is injected everywhere. */
function isGroupOnPage(groupEntrypoints: Set<string> | undefined, pageEntrypoints: Set<string>): boolean {
  if (!groupEntrypoints || groupEntrypoints.size === 0 || pageEntrypoints.size === 0) {
    return true;
  }
  for (const name of groupEntrypoints) {
    if (pageEntrypoints.has(name)) {
      return true;
    }
  }
  return false;
}

function injectLegacySprites(
  html: string,
  data: { html?: string; plugin?: { options?: { chunks?: 'all' | string[] } }; publicPath?: string },
  compilation: BundlerCompilation,
  options: NormalizedOptions,
  entrypointToSpriteResourceToIds: Map<string, Map<string, Set<string>>>,
  spriteResourceToAssetName: Map<string, string>,
  mergedSpriteSvg: string | null,
  mergedSpriteAssetName: string | null,
): string {
  if (options.injectSpritesInTemplates === false) {
    return html;
  }

  const entrypointNames = getEntrypointNamesForHtml(compilation, data.plugin?.options?.chunks);
  if (entrypointNames.length === 0) {
    return html;
  }

  const entrypointSpriteUsage = collectSpriteUsageForEntrypoints(entrypointNames, entrypointToSpriteResourceToIds);
  if (entrypointSpriteUsage.size === 0) {
    return html;
  }

  if (options.injectSpritesInTemplates.mode === 'inline') {
    const inlineSprite = mergedSpriteSvg ?? mergeSprites(entrypointSpriteUsage);
    return injectIntoBody(html, stripXmlDeclaration(inlineSprite).trim());
  }

  const publicPath = getHtmlPublicPath(compilation, data);
  const preloadHrefs = new Set<string>();

  if (options.mode === 'merged') {
    if (mergedSpriteAssetName) {
      preloadHrefs.add(publicPath + mergedSpriteAssetName);
    }
  } else {
    for (const spriteResource of entrypointSpriteUsage.keys()) {
      const assetName = spriteResourceToAssetName.get(spriteResource);
      if (assetName) {
        preloadHrefs.add(publicPath + assetName);
      }
    }
  }

  if (preloadHrefs.size === 0) {
    return html;
  }

  const preloadLinks = Array.from(preloadHrefs)
    .map((href) => `<link rel="preload" as="image" type="image/svg+xml" href="${href}">`)
    .join('\n');
  return injectIntoHead(html, preloadLinks);
}

function collectSpriteUsageForEntrypoints(
  entrypointNames: string[],
  entrypointToSpriteResourceToIds: Map<string, Map<string, Set<string>>>,
): Map<string, Set<string>> {
  const spriteResourceToIds = new Map<string, Set<string>>();

  for (const entrypointName of entrypointNames) {
    const entrypointUsage = entrypointToSpriteResourceToIds.get(entrypointName);
    if (!entrypointUsage) continue;
    for (const [spriteResource, ids] of entrypointUsage) {
      const existing = spriteResourceToIds.get(spriteResource) ?? new Set<string>();
      for (const id of ids) existing.add(id);
      spriteResourceToIds.set(spriteResource, existing);
    }
  }

  return spriteResourceToIds;
}

function isEntrypoint(value: unknown): value is BundlerEntrypoint {
  return Boolean(value && typeof value === 'object' && 'chunks' in value);
}

function collectSpriteUsage(compilation: BundlerCompilation): {
  groups: Map<string, Map<string, Set<string>>>;
  groupEntrypoints: Map<string, Set<string>>;
  entrypoints: Map<string, Map<string, Set<string>>>;
} {
  const groups = new Map<string, Map<string, Set<string>>>();
  const groupEntrypoints = new Map<string, Set<string>>();
  const entrypoints = new Map<string, Map<string, Set<string>>>();
  const entrypointRuntimeByName = new Map<string, string | string[] | ReadonlySet<string> | undefined>();
  const chunkToEntrypointNames = new Map<object, string[]>();

  for (const [entrypointName, entrypointValue] of compilation.entrypoints) {
    if (!isEntrypoint(entrypointValue)) continue;
    const runtimeChunk = entrypointValue.getRuntimeChunk?.();
    entrypointRuntimeByName.set(entrypointName, runtimeChunk?.runtime ?? entrypointValue.runtime);
    for (const chunk of entrypointValue.chunks) {
      const existing = chunkToEntrypointNames.get(chunk) ?? [];
      existing.push(entrypointName);
      chunkToEntrypointNames.set(chunk, existing);
    }
  }

  for (const m of compilation.modules) {
    if (!isFluentUIReactSvgSpriteEntrypointModule(m)) {
      continue;
    }

    const moduleSource = getModuleSource(m);
    const spriteFileAbsPath = getReferencedSpritePath(m.resource, moduleSource);
    if (!spriteFileAbsPath) {
      continue;
    }

    const exportNameToSymbolId = getExportNameToSymbolIdMap(moduleSource);
    if (exportNameToSymbolId.size === 0) {
      continue;
    }

    const group = resolveSpriteGroup(getModuleResourceQuery(m));

    const entrypointNamesForModule = new Set<string>();
    const chunks = compilation.chunkGraph?.getModuleChunksIterable(m);
    if (chunks) {
      for (const chunk of chunks) {
        const names = chunkToEntrypointNames.get(chunk);
        if (!names) continue;
        for (const name of names) entrypointNamesForModule.add(name);
      }
    }
    if (entrypointNamesForModule.size === 0) {
      for (const name of entrypointRuntimeByName.keys()) {
        entrypointNamesForModule.add(name);
      }
    }

    for (const entrypointName of entrypointNamesForModule) {
      const runtime = entrypointRuntimeByName.get(entrypointName);
      const usedExports = getUsedExportsWithFallback(compilation, m, runtime);
      const symbolIds = getUsedSymbolIds(usedExports, exportNameToSymbolId);

      const add = (target: Map<string, Map<string, Set<string>>>, key: string) => {
        const spriteResourceToIds = target.get(key) ?? new Map();
        const existing = spriteResourceToIds.get(spriteFileAbsPath) ?? new Set<string>();
        for (const id of symbolIds) existing.add(id);
        spriteResourceToIds.set(spriteFileAbsPath, existing);
        target.set(key, spriteResourceToIds);
      };

      add(entrypoints, entrypointName);
      add(groups, group);

      const names = groupEntrypoints.get(group) ?? new Set<string>();
      names.add(entrypointName);
      groupEntrypoints.set(group, names);
    }
  }

  return { groups, groupEntrypoints, entrypoints };
}

/**
 * Groups whose atoms were redirected to a generated URL module, read back from the module
 * graph rather than from the resolve hook so it stays correct when a rebuild serves
 * unchanged modules from the cache.
 */
function collectUrlModuleGroups(compilation: BundlerCompilation): Set<string> {
  const groups = new Set<string>();

  for (const m of compilation.modules) {
    if (!isNormalModule(m)) continue;
    const resource = m.resource;
    if (!resource.startsWith(SPRITE_URL_EMPTY)) continue;
    const group = new URLSearchParams(resourceQueryFromResource(resource).replace(/^\?/, '')).get('group');
    if (group) {
      groups.add(group);
    }
  }

  return groups;
}

/** Usage of the groups that still reference their own `.svg` assets, merged per sprite resource. */
function collectUngroupedUsage(
  groupToResourceToIds: Map<string, Map<string, Set<string>>>,
  urlModuleGroups: ReadonlySet<string>,
): Map<string, Set<string>> {
  const usage = new Map<string, Map<string, Set<string>>>();

  for (const [group, resourceToIds] of groupToResourceToIds) {
    if (urlModuleGroups.has(group)) continue;
    usage.set(group, resourceToIds);
  }

  return combineSpriteUsage(usage);
}

function getUsedExportsWithFallback(
  compilation: BundlerCompilation,
  module: BundlerModule,
  runtime: string | string[] | ReadonlySet<string> | undefined,
) {
  const candidates: Array<string | string[] | undefined> = [];
  if (typeof runtime === 'string') {
    candidates.push(runtime, [runtime]);
  } else if (Array.isArray(runtime)) {
    candidates.push(runtime);
  } else if (runtime && typeof (runtime as Iterable<string>)[Symbol.iterator] === 'function') {
    candidates.push(Array.from(runtime));
  }
  // webpack accepts `undefined` ("all runtimes"). rspack throws on it — try/catch below.
  candidates.push(undefined);

  let last: ReturnType<BundlerCompilation['moduleGraph']['getUsedExports']> = null;
  for (const candidate of candidates) {
    try {
      last = compilation.moduleGraph.getUsedExports(module, candidate);
      if (last !== null && typeof last !== 'boolean') {
        return last;
      }
    } catch {
      // rspack: runtime must be string | string[]
    }
  }
  return last;
}

function getSpriteResourceToAssetName(compilation: BundlerCompilation, context: string): Map<string, string> {
  const resourceToAssetName = new Map<string, string>();

  for (const m of compilation.modules) {
    if (!isNormalModule(m)) continue;
    const resource = m.resource;
    if (!resource || !resource.split('?')[0].endsWith('.svg')) continue;
    if (!resource.includes('react-icons')) continue;
    if (!ATOMS_SVG_SPRITE_DIR_PATTERN.test(resource)) continue;
    const assetName = m.buildInfo?.filename;
    if (assetName) {
      resourceToAssetName.set(resource.split('?')[0], assetName);
    }
  }

  for (const { name, info } of compilation.getAssets()) {
    const sourceFilename = info?.sourceFilename;
    if (!sourceFilename || !sourceFilename.endsWith('.svg')) continue;
    const abs = resolve(context, sourceFilename);
    if (!abs.includes('react-icons') || !ATOMS_SVG_SPRITE_DIR_PATTERN.test(abs)) continue;
    if (!resourceToAssetName.has(abs)) {
      resourceToAssetName.set(abs, name);
    }
  }

  return resourceToAssetName;
}

function subsetAtomicSprites(
  compilation: BundlerCompilation,
  spriteResourceToAssetName: Map<string, string>,
  spriteResourceToIds: Map<string, Set<string>>,
  RawSource: BundlerCompiler['webpack']['sources']['RawSource'],
) {
  for (const [spriteResource, usedIds] of spriteResourceToIds) {
    const assetName = spriteResourceToAssetName.get(spriteResource);
    if (!assetName) continue;
    const asset = compilation.getAsset(assetName);
    if (!asset) continue;

    let source = asset.source.source();
    if (typeof source !== 'string') {
      source = source.toString();
    }

    compilation.updateAsset(assetName, new RawSource(subsetSpriteSvg(source, usedIds)));
  }
}

function isFluentUIReactSvgSpriteEntrypointModule(m: BundlerModule): m is BundlerNormalModule {
  if (!isNormalModule(m)) {
    return false;
  }
  const resource = m.resource.split('?')[0];
  if (!resource.includes('react-icons')) {
    return false;
  }
  return REACT_ICONS_SVG_SPRITE_JS_MODULE_IMPORT_PATTERN.test(resource);
}

function getModuleSource(m: BundlerNormalModule): string {
  const maybeSource = m.originalSource?.();
  if (maybeSource) {
    const src = maybeSource.source();
    if (typeof src === 'string') {
      return src;
    }
    return src.toString();
  }
  return readFileSync(m.resource.split('?')[0], 'utf8');
}

/**
 * Swaps each `__FLUENT_SPRITE_URL__<group>__` placeholder for the emitted sprite filename,
 * which is only known once the sprite's content hash exists.
 *
 * Uses `ReplaceSource` so the surrounding chunk keeps its source map. The substitution
 * happens after chunk hashing, so hashed JS filenames only stay in sync while
 * `optimization.realContentHash` is on (webpack's production default) — hence the warning.
 */
function replaceSpriteUrlPlaceholders(
  compiler: BundlerCompiler,
  compilation: BundlerCompilation,
  groupToAssetName: Map<string, string>,
  pluginName: string,
) {
  const { RawSource, ReplaceSource } = compiler.webpack.sources;
  let replacedAny = false;
  let unresolvedPlaceholder = false;

  for (const asset of compilation.getAssets()) {
    if (!/\.(m?js|cjs)$/.test(asset.name)) {
      continue;
    }
    let source = asset.source.source();
    if (typeof source !== 'string') {
      source = source.toString();
    }
    if (!source.includes(SPRITE_URL_PLACEHOLDER_PREFIX)) {
      continue;
    }

    const spans = findPlaceholderSpans(source, groupToAssetName);
    if (spans.length === 0) {
      unresolvedPlaceholder = true;
      continue;
    }

    if (ReplaceSource) {
      const replaced = new ReplaceSource(asset.source);
      for (const span of spans) {
        replaced.replace(span.start, span.end, span.value);
      }
      compilation.updateAsset(asset.name, replaced);
    } else {
      let next = source;
      for (const [group, assetName] of groupToAssetName) {
        next = next.split(spriteUrlPlaceholder(group)).join(assetName);
      }
      compilation.updateAsset(asset.name, new RawSource(next));
    }

    replacedAny = true;
    unresolvedPlaceholder ||= countOccurrences(source, SPRITE_URL_PLACEHOLDER_PREFIX) > spans.length;
  }

  if (unresolvedPlaceholder) {
    compilation.warnings.push(
      new Error(
        `${pluginName}: the bundle references a sprite group that was never emitted, so its URL could not be resolved. ` +
          `This usually means the group's icons were removed after the sprite was planned.`,
      ),
    );
  }

  if (replacedAny && shouldWarnAboutRealContentHash(compiler, compilation)) {
    compilation.warnings.push(
      new Error(
        `${pluginName}: sprite URLs are substituted after chunk hashing, but optimization.realContentHash is disabled ` +
          `while JS filenames use a hash. Emitted JS keeps its old filename when only a sprite's content changes, so a ` +
          `long-term cache can serve a bundle pointing at a sprite that no longer exists.`,
      ),
    );
  }
}

function findPlaceholderSpans(
  source: string,
  groupToAssetName: Map<string, string>,
): Array<{ start: number; end: number; value: string }> {
  const spans: Array<{ start: number; end: number; value: string }> = [];

  for (const [group, assetName] of groupToAssetName) {
    const placeholder = spriteUrlPlaceholder(group);
    for (let at = source.indexOf(placeholder); at !== -1; at = source.indexOf(placeholder, at + placeholder.length)) {
      spans.push({ start: at, end: at + placeholder.length - 1, value: assetName });
    }
  }

  return spans;
}

function countOccurrences(source: string, needle: string): number {
  let count = 0;
  for (let at = source.indexOf(needle); at !== -1; at = source.indexOf(needle, at + needle.length)) {
    count += 1;
  }
  return count;
}

function shouldWarnAboutRealContentHash(compiler: BundlerCompiler, compilation: BundlerCompilation): boolean {
  if (compiler.options?.optimization?.realContentHash !== false) {
    return false;
  }
  const templates = [compilation.outputOptions?.filename, compilation.outputOptions?.chunkFilename];
  return templates.some((template) => typeof template === 'string' && /\[(content|chunk|full)hash/.test(template));
}

/**
 * An inlined group's atoms render `<use href="#id">` and rely on the symbols being in the
 * document, so a group that never reached a template renders nothing at all.
 */
function warnAboutUninjectedInlineGroups(
  compilation: BundlerCompilation,
  groupToSvg: Map<string, string>,
  injectedInlineGroups: ReadonlySet<string>,
  options: NormalizedOptions,
): void {
  const missing = Array.from(groupToSvg.keys()).filter(
    (group) => resolveGroupConfig(group, options).inline && !injectedInlineGroups.has(group),
  );
  if (missing.length === 0) {
    return;
  }

  compilation.warnings.push(
    new Error(
      `${PLUGIN_NAME}: sprite group(s) ${missing.join(', ')} are configured as inline but were not injected into any HTML template, ` +
        `so their icons resolve to symbols that are not in the document. Install html-webpack-plugin (or HtmlRspackPlugin) and keep ` +
        `injectSpritesInTemplates enabled, or drop \`inline\` for these groups.`,
    ),
  );
}

function buildSpritesManifest(
  entrypointToSpriteResourceToIds: Map<string, Map<string, Set<string>>>,
  spriteResourceToAssetName: Map<string, string>,
  groupToAssetName: Map<string, string>,
  mode: SvgSpriteOptimizationMode | 'grouped',
) {
  const manifest: Record<string, unknown> = {};

  if (mode === 'grouped') {
    manifest.groups = Object.fromEntries(
      Array.from(groupToAssetName.entries()).map(([group, assetName]) => [group, { assetName }]),
    );
  }

  for (const [entrypointName, spriteResourceToIds] of entrypointToSpriteResourceToIds) {
    if (mode === 'merged') {
      manifest[entrypointName] = {
        mergedSprite: {
          assetName: groupToAssetName.get(DEFAULT_SPRITE_GROUP) ?? undefined,
          ids: collectSortedIds(spriteResourceToIds),
        },
      };
      continue;
    }

    const sprites = Array.from(spriteResourceToIds.entries()).map(([spriteResourceAbsPath, ids]) => ({
      spriteResourceAbsPath,
      assetName: spriteResourceToAssetName.get(spriteResourceAbsPath),
      ids: Array.from(ids).sort(),
    }));

    manifest[entrypointName] = { sprites };
  }

  return manifest;
}
