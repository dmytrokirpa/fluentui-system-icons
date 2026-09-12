import { realpathSync } from 'fs';
import { dirname } from 'path';

import { DEFAULT_SAFETY_VARIANT } from './modules';
import type { IconVariant } from './modules';

export const ICON_VARIANTS: readonly IconVariant[] = ['svg', 'fonts', 'svg-sprite'];

/** Group name used when an svg-sprite import has no `sprite` query or rule. */
export const DEFAULT_SPRITE_GROUP = 'main';

/**
 * Webpack-like rule condition: a substring, a `RegExp`, a predicate, or an any-of list.
 * Functions are supported in-process; prefer `string` / `RegExp` so loader options stay serializable.
 *
 * `\` and `/` are treated as the same separator: `{ test: /@myorg\/app-nav/ }` matches a
 * Windows `resourcePath` with backslashes.
 */
export type RuleCondition = string | RegExp | ((resource: string) => boolean) | RuleCondition[];

/**
 * A per-file rewrite rule. First match wins (see {@link findMatchingRule}).
 *
 * `test` / `include` / `exclude` / `package` are matched against the loader's
 * `resourcePath` (the file being transformed), the same way webpack module rules
 * match. The webpack config can live at the app; rules still target a dependency
 * by `package` name (see {@link matchPackage}).
 */
export interface VariantRule {
  test?: RuleCondition;
  include?: RuleCondition;
  exclude?: RuleCondition;
  /**
   * Package name whose files this rule applies to, e.g. `'@myorg/app-nav'`.
   * Resolved from the file being transformed (follows yarn/pnpm/npm layouts and
   * webpack's symlink realpath). `string[]` is any-of.
   */
  package?: string | string[];
  iconVariant?: IconVariant;
  headless?: boolean;
  /** Named sprite group. Only applied when the resolved variant is `svg-sprite`. */
  sprite?: string;
}

export interface ImportSpecifierParts {
  /** Bare module specifier with any `?query` stripped. */
  name: string;
  query: URLSearchParams;
}

export interface FileVariantDefaults {
  iconVariant: IconVariant;
  headless: boolean;
  sprite?: string;
}

export interface ImportVariantOverride {
  iconVariant?: IconVariant;
  headless?: boolean;
  sprite?: string;
}

/**
 * Splits a module specifier into the bare name and its resource query.
 *
 * @example
 * parseImportSpecifier('@fluentui/react-icons?variant=fonts')
 * // { name: '@fluentui/react-icons', query: URLSearchParams { variant: 'fonts' } }
 */
export function parseImportSpecifier(specifier: string): ImportSpecifierParts {
  const hashIndex = specifier.indexOf('#');
  const withoutHash = hashIndex === -1 ? specifier : specifier.slice(0, hashIndex);
  const queryIndex = withoutHash.indexOf('?');
  if (queryIndex === -1) {
    return { name: withoutHash, query: new URLSearchParams() };
  }
  return {
    name: withoutHash.slice(0, queryIndex),
    query: new URLSearchParams(withoutHash.slice(queryIndex + 1)),
  };
}

export function isIconVariant(value: string | null | undefined): value is IconVariant {
  return value === 'svg' || value === 'fonts' || value === 'svg-sprite';
}

export function matchRuleCondition(condition: RuleCondition, resource: string): boolean {
  if (Array.isArray(condition)) {
    return condition.some((entry) => matchRuleCondition(entry, resource));
  }
  if (typeof condition === 'function') {
    return withPathForms(resource, (path) => condition(path));
  }
  if (typeof condition === 'string') {
    return withPathForms(resource, (path) => withPathForms(condition, (needle) => path.includes(needle)));
  }
  return withPathForms(resource, (path) => condition.test(path));
}

/** Tries `filePath` as written and with `\` folded to `/`. */
function withPathForms(filePath: string, fn: (path: string) => boolean): boolean {
  if (fn(filePath)) {
    return true;
  }
  const normalized = normalizePath(filePath);
  return normalized !== filePath && fn(normalized);
}

/**
 * Returns whether `resource` matches a single rule, following webpack's
 * `test` ∧ `include` ∧ `package` ∧ ¬`exclude` semantics. A missing `test` /
 * `include` / `package` is treated as a match so a rule can be exclude-only
 * or catch-all.
 */
export function matchesRule(rule: VariantRule, resource: string): boolean {
  if (rule.test !== undefined && !matchRuleCondition(rule.test, resource)) {
    return false;
  }
  if (rule.include !== undefined && !matchRuleCondition(rule.include, resource)) {
    return false;
  }
  if (rule.package !== undefined && !matchPackage(rule.package, resource)) {
    return false;
  }
  if (rule.exclude !== undefined && matchRuleCondition(rule.exclude, resource)) {
    return false;
  }
  return true;
}

/**
 * True when `resource` is a file inside `packageName` (or any name in the list).
 *
 * Resolves `packageName/package.json` from `resource`'s directory so an app-level
 * webpack config can target `@myorg/app-nav` even when webpack realpaths a
 * workspace symlink to `packages/app-nav`.
 */
export function matchPackage(packageName: string | string[], resource: string): boolean {
  const names = Array.isArray(packageName) ? packageName : [packageName];
  return names.some((name) => matchOnePackage(name, resource));
}

function matchOnePackage(packageName: string, resource: string): boolean {
  let pkgJson: string;
  try {
    pkgJson = require.resolve(`${packageName}/package.json`, { paths: [dirname(resource)] });
  } catch {
    return false;
  }

  const roots = pathCandidates(dirname(pkgJson));
  const files = pathCandidates(resource);
  for (const file of files) {
    for (const root of roots) {
      if (file === root || file.startsWith(`${root}/`)) {
        return true;
      }
    }
  }
  return false;
}

function pathCandidates(filePath: string): string[] {
  const normalized = normalizePath(filePath);
  const out = [normalized];
  try {
    const real = normalizePath(realpathSync(filePath));
    if (real !== normalized) {
      out.push(real);
    }
  } catch {
    // resourcePath always exists for the loader; tests may pass a synthetic path.
  }
  return out;
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

/** First matching rule wins. Returns `undefined` when `rules` is empty or none match. */
export function findMatchingRule(resource: string, rules: readonly VariantRule[] | undefined): VariantRule | undefined {
  if (!rules || rules.length === 0) {
    return undefined;
  }
  return rules.find((rule) => matchesRule(rule, resource));
}

/**
 * File-level defaults after applying `variantRules` on top of the loader's global options.
 * Import queries are layered on afterwards by {@link resolveImportOverride}.
 */
export function resolveFileDefaults(
  resource: string,
  options: {
    iconVariant: IconVariant;
    headless?: boolean;
    variantRules?: readonly VariantRule[];
  },
): FileVariantDefaults {
  const rule = findMatchingRule(resource, options.variantRules);
  return {
    iconVariant: rule?.iconVariant ?? options.iconVariant,
    headless: rule?.headless ?? options.headless ?? false,
    sprite: rule?.sprite,
  };
}

/**
 * Per-import query overrides (`?variant=`, `?sprite=`, `?headless=`).
 * Unknown `variant` values are ignored (caller may warn).
 */
export function resolveImportOverride(query: URLSearchParams): ImportVariantOverride {
  const variantParam = query.get('variant');
  const spriteParam = query.get('sprite');
  const headlessParam = query.get('headless');

  const override: ImportVariantOverride = {};
  if (isIconVariant(variantParam)) {
    override.iconVariant = variantParam;
  }
  if (spriteParam) {
    override.sprite = spriteParam;
  }
  if (headlessParam !== null) {
    override.headless = headlessParam !== 'false' && headlessParam !== '0';
  }
  return override;
}

/**
 * Effective requested variant / headless / sprite for a single import, before
 * module-level `iconVariant → fallbackVariant → svg` resolution.
 *
 * Precedence: import query → first matching rule → global `iconVariant` → `'svg'`.
 */
export function resolveRequestedTarget(
  fileDefaults: FileVariantDefaults,
  override: ImportVariantOverride,
): { iconVariant: IconVariant; headless: boolean; sprite?: string } {
  const iconVariant = override.iconVariant ?? fileDefaults.iconVariant ?? DEFAULT_SAFETY_VARIANT;
  const headless = override.headless ?? fileDefaults.headless;
  const sprite = override.sprite ?? fileDefaults.sprite;
  return { iconVariant, headless, sprite };
}

/**
 * Appends `?sprite=<group>` to an already-resolved atomic svg-sprite path.
 * No-ops when `sprite` is empty or the path is not an svg-sprite atom.
 */
export function appendSpriteQuery(resolvedSource: string, sprite: string | undefined, variant: IconVariant): string {
  if (!sprite || variant !== 'svg-sprite') {
    return resolvedSource;
  }
  const { name, query } = parseImportSpecifier(resolvedSource);
  if (!query.has('sprite')) {
    query.set('sprite', sprite);
  }
  const serialized = query.toString();
  return serialized ? `${name}?${serialized}` : name;
}
