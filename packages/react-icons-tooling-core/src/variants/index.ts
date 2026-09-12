import { DEFAULT_SAFETY_VARIANT } from '../rewrite/modules';
import type { IconVariant } from '../rewrite/modules';

export const ICON_VARIANTS: readonly IconVariant[] = ['svg', 'fonts', 'svg-sprite'];

/** Group name used when an svg-sprite import has no `sprite` query or rule. */
export const DEFAULT_SPRITE_GROUP = 'main';

/**
 * Webpack-like rule condition: a substring, a `RegExp`, a predicate, or an any-of list.
 * Functions are supported in-process; prefer `string` / `RegExp` so loader options stay serializable.
 */
export type RuleCondition = string | RegExp | ((resource: string) => boolean) | RuleCondition[];

/**
 * A per-file rewrite rule. First match wins (see {@link findMatchingRule}).
 *
 * `test` / `include` / `exclude` are matched against the loader's `resourcePath`
 * (the file being transformed), the same way webpack module rules match.
 */
export interface VariantRule {
  test?: RuleCondition;
  include?: RuleCondition;
  exclude?: RuleCondition;
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
  if (typeof condition === 'string') {
    return resource.includes(condition);
  }
  if (condition instanceof RegExp) {
    return condition.test(resource);
  }
  if (typeof condition === 'function') {
    return condition(resource);
  }
  return condition.some((entry) => matchRuleCondition(entry, resource));
}

/**
 * Returns whether `resource` matches a single rule, following webpack's
 * `test` ∧ `include` ∧ ¬`exclude` semantics. A missing `test` / `include`
 * is treated as a match so a rule can be exclude-only or catch-all.
 */
export function matchesRule(rule: VariantRule, resource: string): boolean {
  if (rule.test !== undefined && !matchRuleCondition(rule.test, resource)) {
    return false;
  }
  if (rule.include !== undefined && !matchRuleCondition(rule.include, resource)) {
    return false;
  }
  if (rule.exclude !== undefined && matchRuleCondition(rule.exclude, resource)) {
    return false;
  }
  return true;
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
