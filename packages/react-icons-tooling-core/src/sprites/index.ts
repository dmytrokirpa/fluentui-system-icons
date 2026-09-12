import { createHash } from 'crypto';
import { dirname, resolve } from 'path';
import { readFileSync } from 'fs';

import type { BundlerCompilation, BundlerCompiler } from '../bundler-api';
import { DEFAULT_SPRITE_GROUP } from '../variants';

/** Matches individual `<symbol>` elements and captures their `id` attribute. */
export const SYMBOL_ELEMENT_PATTERN = /<symbol\b[^>]*\bid="([^"]+)"[^>]*>[\s\S]*?<\/symbol>/g;

/**
 * Matches the ESM and CJS `@fluentui/react-icons/svg-sprite/*` entrypoints.
 *
 * Examples:
 * - .../react-icons/lib/atoms/svg-sprite/backpack.js
 * - .../react-icons/lib-cjs/atoms/svg-sprite/backpack.cjs
 */
export const REACT_ICONS_SVG_SPRITE_JS_MODULE_IMPORT_PATTERN =
  /react-icons[\/\\]lib(-cjs)?[\/\\]atoms[\/\\]svg-sprite[\/\\][\w-]+\.c?js$/;

export const ATOMS_SVG_SPRITE_DIR_PATTERN = /(^|[\/\\])atoms[\/\\]svg-sprite([\/\\]|$)/;

export type SvgSpriteOptimizationMode = 'atomic' | 'merged';

export type SharedSymbolsPolicy = 'duplicate' | 'hoist';

export interface SpriteGroupOptions {
  inline?: boolean;
  prefetch?: boolean;
  /** Filename template. Supports `[name]`, `[fullhash]`, and `[contenthash]`. */
  filename?: string;
}

export interface SpriteSymbol {
  id: string;
  source: string;
}

export function extractSymbols(svgText: string): SpriteSymbol[] {
  const symbols: SpriteSymbol[] = [];
  const pattern = new RegExp(SYMBOL_ELEMENT_PATTERN.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(svgText))) {
    symbols.push({ id: match[1], source: match[0] });
  }
  return symbols;
}

/**
 * Wraps an array of `<symbol>` element strings into a complete SVG sprite
 * document with an XML declaration. Each symbol is indented with two spaces
 * if not already indented.
 */
export function wrapSymbolsInSvg(symbols: string[]): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<svg xmlns="http://www.w3.org/2000/svg" style="display: none;">\n' +
    symbols.map((s) => (s.startsWith('  ') ? s : `  ${s}`)).join('\n') +
    '\n</svg>\n'
  );
}

/**
 * Removes unused `<symbol>` elements from an SVG sprite string, keeping only
 * those whose IDs appear in `usedIds`. Returns the original SVG unchanged if
 * no symbols match (defensive fallback) or if `usedIds` is empty.
 */
export function subsetSpriteSvg(svgText: string, usedIds: Set<string>): string {
  if (usedIds.size === 0) {
    return svgText;
  }

  const keptSymbols: string[] = [];
  for (const symbol of extractSymbols(svgText)) {
    if (usedIds.has(symbol.id)) {
      keptSymbols.push(symbol.source);
    }
  }

  if (keptSymbols.length === 0) {
    return svgText;
  }

  return wrapSymbolsInSvg(keptSymbols);
}

/**
 * Reads multiple sprite SVG files from disk and merges their used `<symbol>`
 * elements into a single SVG sprite document, deduplicating by symbol ID.
 */
export function mergeSprites(spriteResourceToIds: Map<string, Set<string>>): string {
  const mergedSymbolsById = new Map<string, string>();

  for (const [spriteResource, usedIds] of spriteResourceToIds) {
    const svgText = readFileSync(spriteResource, 'utf8');
    for (const symbol of extractSymbols(svgText)) {
      if (usedIds.has(symbol.id) && !mergedSymbolsById.has(symbol.id)) {
        mergedSymbolsById.set(symbol.id, symbol.source);
      }
    }
  }

  return wrapSymbolsInSvg(Array.from(mergedSymbolsById.values()));
}

/** @deprecated Use {@link mergeSprites}. */
export const buildMergedSprite = mergeSprites;

export interface SpriteGroupUsage {
  /** group → sprite resource path → symbol ids */
  groups: Map<string, Map<string, Set<string>>>;
  /** Symbol ids that appear in more than one group (after policy). */
  duplicatedIds: string[];
}

/**
 * Buckets per-resource symbol usage into named sprite groups.
 *
 * - `'duplicate'` (default): an icon used in two groups is emitted in both.
 * - `'hoist'`: symbols that appear in any `inlinedGroups` entry are dropped from
 *   every other group. Runtime URL rewriting so those atoms point at the inlined
 *   sprite is the plugin's job; this helper only shapes the symbol sets.
 */
export function groupSymbols(
  usage: Map<string, Map<string, Set<string>>>,
  policy: SharedSymbolsPolicy = 'duplicate',
  inlinedGroups: ReadonlySet<string> = new Set(),
): SpriteGroupUsage {
  const groups = new Map<string, Map<string, Set<string>>>();

  for (const [group, spriteResourceToIds] of usage) {
    const clone = new Map<string, Set<string>>();
    for (const [resource, ids] of spriteResourceToIds) {
      clone.set(resource, new Set(ids));
    }
    groups.set(group, clone);
  }

  if (policy === 'hoist' && inlinedGroups.size > 0) {
    const hoistedIds = new Set<string>();
    for (const group of inlinedGroups) {
      const resources = groups.get(group);
      if (!resources) continue;
      for (const ids of resources.values()) {
        for (const id of ids) {
          hoistedIds.add(id);
        }
      }
    }

    for (const [group, resources] of groups) {
      if (inlinedGroups.has(group)) continue;
      for (const ids of resources.values()) {
        for (const id of hoistedIds) {
          ids.delete(id);
        }
      }
    }
  }

  return { groups, duplicatedIds: findDuplicatedSymbolIds(groups) };
}

export function findDuplicatedSymbolIds(groups: Map<string, Map<string, Set<string>>>): string[] {
  const seen = new Map<string, number>();
  for (const resources of groups.values()) {
    const idsInGroup = new Set<string>();
    for (const ids of resources.values()) {
      for (const id of ids) {
        idsInGroup.add(id);
      }
    }
    for (const id of idsInGroup) {
      seen.set(id, (seen.get(id) ?? 0) + 1);
    }
  }
  return Array.from(seen.entries())
    .filter(([, count]) => count >= 2)
    .map(([id]) => id)
    .sort();
}

export function parseSpriteGroupFromQuery(resourceQuery: string | undefined | null): string | undefined {
  if (!resourceQuery) {
    return undefined;
  }
  const trimmed = resourceQuery.startsWith('?') ? resourceQuery.slice(1) : resourceQuery;
  const sprite = new URLSearchParams(trimmed).get('sprite');
  return sprite || undefined;
}

export function resourceQueryFromResource(resource: string | undefined | null): string {
  if (!resource) {
    return '';
  }
  const q = resource.indexOf('?');
  return q === -1 ? '' : resource.slice(q);
}

/**
 * Recovers the resource query from a bundler module. Webpack file aliases and
 * concatenated modules sometimes drop `resourceQuery` while still leaving it on
 * `userRequest` / `rawRequest` / `resource`.
 */
export function getModuleResourceQuery(module: {
  resourceQuery?: string;
  resource?: string;
  userRequest?: string;
  rawRequest?: string;
}): string {
  if (typeof module.resourceQuery === 'string' && module.resourceQuery.length > 0) {
    return module.resourceQuery;
  }
  for (const candidate of [module.resource, module.userRequest, module.rawRequest]) {
    const query = resourceQueryFromResource(candidate);
    if (query) {
      return query;
    }
  }
  return '';
}

export function resolveSpriteGroup(resourceQuery: string | undefined | null): string {
  return parseSpriteGroupFromQuery(resourceQuery) ?? DEFAULT_SPRITE_GROUP;
}

/**
 * Throws if a sprite filename template contains unsupported placeholders.
 * `[name]`, `[fullhash]`, and `[contenthash]` are allowed.
 */
export function assertValidSpriteFilename(filename: string, pluginName: string) {
  const invalidToken = filename.match(/\[(?!fullhash|contenthash|name)[^\]]+\]/);
  if (invalidToken) {
    throw new Error(`${pluginName}: sprite filename only supports [name], [fullhash], and [contenthash] placeholders.`);
  }
}

export function resolveSpriteFilename(
  template: string,
  replacements: { name?: string; fullHash?: string; contentHash?: string },
): string {
  return template
    .replace(/\[name\]/g, replacements.name ?? DEFAULT_SPRITE_GROUP)
    .replace(/\[fullhash\]/g, replacements.fullHash ?? '')
    .replace(/\[contenthash\]/g, replacements.contentHash ?? '');
}

/**
 * Creates a content-based hash for the given string. Prefers the bundler's
 * `webpack.util.createHash` (honors xxhash64 / md4) and falls back to node crypto.
 */
export function createContentHash(compiler: BundlerCompiler, compilation: BundlerCompilation, content: string): string {
  const { hashFunction, hashDigest, hashDigestLength } = compilation.outputOptions;
  const effectiveHashDigest = (typeof hashDigest === 'string' && hashDigest) || 'hex';
  const length = typeof hashDigestLength === 'number' ? hashDigestLength : undefined;

  const webpackHash = compiler.webpack.util?.createHash;
  if (typeof webpackHash === 'function') {
    const hash = webpackHash(hashFunction || 'md4');
    hash.update(content);
    const digest = hash.digest(effectiveHashDigest);
    const text = typeof digest === 'string' ? digest : digest.toString('hex');
    return length ? text.slice(0, length) : text;
  }

  const algorithm = typeof hashFunction === 'string' && hashFunction !== 'md4' ? hashFunction : 'sha256';
  let hash;
  try {
    hash = createHash(algorithm);
  } catch {
    hash = createHash('sha256');
  }
  hash.update(content);
  const digest = hash.digest(effectiveHashDigest === 'hex' ? 'hex' : 'hex');
  return length ? digest.slice(0, length) : digest;
}

export function stripXmlDeclaration(svgText: string): string {
  return svgText.replace(/^<\?xml[^>]*>\s*/i, '');
}

export function injectIntoBody(html: string, inlineSvg: string): string {
  const bodyTag = html.match(/<body[^>]*>/i);
  if (!bodyTag) {
    return `${inlineSvg}\n${html}`;
  }
  return html.replace(/<body[^>]*>/i, (match) => `${match}\n${inlineSvg}`);
}

export function injectIntoHead(html: string, headMarkup: string): string {
  const headTag = html.match(/<head[^>]*>/i);
  if (!headTag) {
    return `${headMarkup}\n${html}`;
  }
  return html.replace(/<head[^>]*>/i, (match) => `${match}\n${headMarkup}`);
}

export function getReferencedSpritePath(moduleResource: string, moduleSource: string): string | null {
  const resourcePath = moduleResource.split('?')[0];
  const esm = moduleSource.match(/import\s+\w+\s+from\s+['"](.+?\.svg)['"];?/);
  const rawPath = esm?.[1];
  if (rawPath) {
    return resolve(dirname(resourcePath), rawPath);
  }

  const cjs = moduleSource.match(/require\(['"](.+?\.svg)['"]\)/);
  const rawPath2 = cjs?.[1];
  if (rawPath2) {
    return resolve(dirname(resourcePath), rawPath2);
  }

  return null;
}

export function getExportNameToSymbolIdMap(moduleSource: string): Map<string, string> {
  const map = new Map<string, string>();
  const exportRegex = /export\s+const\s+(\w+)\s*=\s*\([^)]*?createFluentIcon\(\s*['"]([^'"]+)['"]/g;

  let match: RegExpExecArray | null;
  while ((match = exportRegex.exec(moduleSource))) {
    map.set(match[1], match[2]);
  }

  return map;
}

export function getUsedSymbolIds(
  usedExports: ReadonlySet<string> | readonly string[] | boolean | null | undefined,
  exportNameToSymbolId: Map<string, string>,
): Set<string> {
  const usedIds = new Set<string>();

  if (usedExports === null || usedExports === undefined || typeof usedExports === 'boolean') {
    for (const symbolId of exportNameToSymbolId.values()) {
      usedIds.add(symbolId);
    }
    return usedIds;
  }

  for (const exportName of usedExports) {
    const symbolId = exportNameToSymbolId.get(exportName);
    if (symbolId) {
      usedIds.add(symbolId);
    }
  }

  return usedIds;
}

export function collectSortedIds(spriteResourceToIds: Map<string, Set<string>>): string[] {
  const ids = new Set<string>();
  for (const spriteIds of spriteResourceToIds.values()) {
    for (const id of spriteIds) {
      ids.add(id);
    }
  }
  return Array.from(ids).sort();
}

export function combineSpriteUsage(
  entrypointToSpriteResourceToIds: Map<string, Map<string, Set<string>>>,
): Map<string, Set<string>> {
  const combinedSpriteResourceToIds = new Map<string, Set<string>>();

  for (const spriteResourceToIds of entrypointToSpriteResourceToIds.values()) {
    for (const [spriteResource, ids] of spriteResourceToIds) {
      const existing = combinedSpriteResourceToIds.get(spriteResource) ?? new Set<string>();
      for (const id of ids) {
        existing.add(id);
      }
      combinedSpriteResourceToIds.set(spriteResource, existing);
    }
  }

  return combinedSpriteResourceToIds;
}

export const SPRITE_URL_PLACEHOLDER_PREFIX = '__FLUENT_SPRITE_URL__';
export const SPRITE_URL_PLACEHOLDER_SUFFIX = '__';

export function spriteUrlPlaceholder(group: string): string {
  return `${SPRITE_URL_PLACEHOLDER_PREFIX}${group}${SPRITE_URL_PLACEHOLDER_SUFFIX}`;
}
