import { parseSync, Visitor } from 'oxc-parser';
import type { ObjectPattern } from 'oxc-parser';
import MagicString from 'magic-string';

import {
  getModuleDescriptor,
  resolveModuleVariant,
  resolveColorVariant,
  resolveModuleHeadless,
  isColorIconName,
  SUPPORTED_MODULE_NAMES,
} from './modules';
import type { IconVariant, ModuleDescriptor } from './modules';
import {
  appendSpriteQuery,
  isIconVariant,
  parseImportSpecifier,
  resolveFileDefaults,
  resolveImportOverride,
  resolveRequestedTarget,
} from '../variants';
import type { VariantRule } from '../variants';

export interface TransformOptions {
  /** The requested icon variant. Applied to every supported module unless a rule or import query overrides it. */
  iconVariant: IconVariant;
  /** The variant to fall back to when a module does not support `iconVariant`. */
  fallbackVariant?: IconVariant;
  /** Resolve to the headless (Griffel-free) build where the module supports it. */
  headless?: boolean;
  /**
   * Rewrite a narrow, statically-provable subset of dynamic `import()` barrel
   * calls into atomic dynamic imports (see {@link rewriteDynamicImports}).
   * Defaults to `false`. Un-rewritable dynamic barrel imports still warn.
   */
  allowDynamicImports?: boolean;
  /**
   * Per-file rewrite rules. First match against `path` wins; see {@link VariantRule}.
   * Import queries (`?variant=` / `?sprite=`) still override a matching rule.
   */
  variantRules?: VariantRule[];
  path: string;
}

export interface Diagnostic {
  level: 'error' | 'warning';
  message: string;
}

export interface TransformResult {
  code: string;
  map: ReturnType<MagicString['generateMap']>;
  /**
   * Diagnostics gathered while rewriting. Only modules that are actually
   * imported/re-exported (as reported by the parsed module record) contribute
   * diagnostics, so mentions in comments or string literals never trigger one.
   */
  diagnostics: Diagnostic[];
}

/** A module's resolved rewrite target: the icon variant, headless flag, and optional sprite group. */
type ResolvedTarget = { variant: IconVariant; headless: boolean; sprite?: string };

/** One atom's worth of destructured specifiers, e.g. `{ source, specs: ['AddFilled', 'AddRegular'] }`. */
type RewriteGroup = { source: string; specs: string[] };

export function transformSource(source: string, options: TransformOptions): TransformResult {
  const { iconVariant, fallbackVariant, headless = false, allowDynamicImports = false, variantRules, path } = options;
  const fileDefaults = resolveFileDefaults(path, { iconVariant, headless, variantRules });

  const result = parseSync(path, source, {
    sourceType: 'module',
  });

  if (result.errors.length > 0) {
    throw new Error(result.errors[0].message);
  }

  const { staticImports, staticExports, dynamicImports } = result.module;
  const src = new MagicString(source);

  const diagnostics: Diagnostic[] = [];
  // Dedupe diagnostics by message so a module's variant / color / headless
  // concern surfaces at most once, even though resolution now runs per
  // (module, color-ness) rather than per module.
  const seenDiagnostics = new Set<string>();
  const pushDiagnostic = (diagnostic: Diagnostic): void => {
    const key = `${diagnostic.level}:${diagnostic.message}`;
    if (seenDiagnostics.has(key)) return;
    seenDiagnostics.add(key);
    diagnostics.push(diagnostic);
  };

  // Resolve each referenced module at most once per (color-ness, requested variant,
  // headless, sprite group). Color icons may route to a different variant than their
  // non-color siblings; import queries and per-file rules can also diverge.
  const resolvedTargets = new Map<string, ResolvedTarget | null>();

  /**
   * Returns the target (variant + headless + sprite group) to rewrite a single
   * referenced import with, or `null` when the module could not be resolved (an
   * error diagnostic has been recorded and the import should be left untouched).
   */
  const targetFor = (
    descriptor: ModuleDescriptor,
    isColor: boolean,
    requested: { iconVariant: IconVariant; headless: boolean; sprite?: string },
  ): ResolvedTarget | null => {
    const cacheKey = `${descriptor.name}:${isColor}:${requested.iconVariant}:${requested.headless}:${requested.sprite ?? ''}`;
    if (resolvedTargets.has(cacheKey)) {
      return resolvedTargets.get(cacheKey)!;
    }

    const resolution = resolveModuleVariant(descriptor, requested.iconVariant, fallbackVariant);

    if (resolution.warning) {
      pushDiagnostic({ level: 'warning', message: resolution.warning });
    }
    if (resolution.error) {
      pushDiagnostic({ level: 'error', message: resolution.error });
    }

    if (!resolution.variant) {
      resolvedTargets.set(cacheKey, null);
      return null;
    }

    let variant = resolution.variant;

    // Color icons are SVG-only; reroute them off any color-less variant (fonts)
    // to a color-capable one, honoring the fallback precedence.
    if (isColor) {
      const colorResolution = resolveColorVariant(descriptor, variant, requested.iconVariant, fallbackVariant);
      if (colorResolution.warning) {
        pushDiagnostic({ level: 'warning', message: colorResolution.warning });
      }
      variant = colorResolution.variant;
    }

    const headlessResolution = resolveModuleHeadless(descriptor, variant, requested.headless);
    if (headlessResolution.warning) {
      pushDiagnostic({ level: 'warning', message: headlessResolution.warning });
    }

    const target: ResolvedTarget = { variant, headless: headlessResolution.headless, sprite: requested.sprite };
    resolvedTargets.set(cacheKey, target);
    return target;
  };

  const requestedForSpecifier = (
    rawSpecifier: string,
  ): { iconVariant: IconVariant; headless: boolean; sprite?: string } => {
    const { query } = parseImportSpecifier(rawSpecifier);
    const override = resolveImportOverride(query);
    if (query.get('variant') && !isIconVariant(query.get('variant'))) {
      pushDiagnostic({
        level: 'warning',
        message: `ignored unknown icon variant query "${query.get('variant')}" on "${rawSpecifier}".`,
      });
    }
    return resolveRequestedTarget(fileDefaults, override);
  };

  const atomicSourceFor = (descriptor: ModuleDescriptor, importedName: string, target: ResolvedTarget): string => {
    const resolved = descriptor.resolve(importedName, target.variant, target.headless);
    return appendSpriteQuery(resolved, target.sprite, target.variant);
  };

  for (const imp of staticImports) {
    const rawSpecifier = imp.moduleRequest.value;
    const { name: moduleName } = parseImportSpecifier(rawSpecifier);
    const descriptor = getModuleDescriptor(moduleName);
    if (!descriptor) continue;

    const namedEntries = imp.entries.filter((e) => e.importName.kind === 'Name');
    if (namedEntries.length === 0) continue;

    const requested = requestedForSpecifier(rawSpecifier);

    // Resolve each named specifier independently — color icons may route to a
    // different variant than their non-color siblings in the same statement.
    const resolvedEntries = namedEntries.map((entry) => ({
      entry,
      importedName: entry.importName.name!,
      target: targetFor(descriptor, isColorIconName(entry.importName.name!), requested),
    }));

    // A module-level resolution error is independent of color-ness, so if any
    // specifier is unresolved they all are — leave the whole statement untouched.
    if (resolvedEntries.some(({ target }) => !target)) continue;

    const otherEntries = imp.entries.filter((e) => e.importName.kind !== 'Name');
    const lines: string[] = [];

    if (otherEntries.length > 0) {
      const names = otherEntries
        .map((e) => (e.importName.kind === 'Default' ? e.localName.value : `* as ${e.localName.value}`))
        .join(', ');
      lines.push(`import ${names} from '${rawSpecifier}';`);
    }

    for (const { entry, importedName, target } of resolvedEntries) {
      const localName = entry.localName.value;
      const newSource = atomicSourceFor(descriptor, importedName, target!);
      const spec = importedName === localName ? importedName : `${importedName} as ${localName}`;
      lines.push(`import { ${spec} } from '${newSource}';`);
    }

    src.overwrite(imp.start, imp.end, lines.join('\n'));
  }

  for (const exp of staticExports) {
    const relevantEntries = exp.entries.filter(
      (e) =>
        e.moduleRequest &&
        getModuleDescriptor(parseImportSpecifier(e.moduleRequest.value).name) &&
        e.exportName.kind === 'Name',
    );
    if (relevantEntries.length === 0) continue;

    // Skip indirect re-exports (`import { X } from '...'; export { X };`): oxc reports these as static
    // exports anchored at the originating `import` statement. The import loop above has already
    // rewritten that range, so emitting again here would produce duplicate declarations.
    if (source.startsWith('import', exp.start)) continue;

    const lines: string[] = [];

    for (const entry of relevantEntries) {
      const rawSpecifier = entry.moduleRequest!.value;
      const { name: moduleName } = parseImportSpecifier(rawSpecifier);
      const descriptor = getModuleDescriptor(moduleName)!;
      const importedName = entry.importName.name!;
      const target = targetFor(descriptor, isColorIconName(importedName), requestedForSpecifier(rawSpecifier));
      if (!target) continue;

      const exportedName = entry.exportName.name!;
      const newSource = atomicSourceFor(descriptor, importedName, target);
      const spec = importedName === exportedName ? importedName : `${importedName} as ${exportedName}`;
      lines.push(`export { ${spec} } from '${newSource}';`);
    }

    if (lines.length === 0) continue;

    src.overwrite(exp.start, exp.end, lines.join('\n'));
  }

  // Source-literal start offsets of dynamic imports that were atomized below.
  // Used to suppress the "cannot be atomized" warning for imports we rewrote.
  const rewrittenImportStarts = new Set<number>();

  if (allowDynamicImports) {
    /**
     * Resolves one destructured binding name to the atomic subpath it should be
     * imported from, honoring the active `iconVariant` / `headless` / color rules
     * (same policy as static imports). Returns `null` when the owning module can't
     * be resolved — `targetFor` has already recorded an error diagnostic — which
     * signals the caller to bail and leave the dynamic import untouched.
     *
     * @example
     * // iconVariant: 'svg'
     * resolveNameSource(reactIcons, 'AddFilled')   // → '@fluentui/react-icons/svg/add'
     * resolveNameSource(reactIcons, 'bundleIcon')  // → '@fluentui/react-icons/utils'
     * // iconVariant: 'fonts'
     * resolveNameSource(reactIcons, 'AddFilled')   // → '@fluentui/react-icons/fonts/add'
     */
    const resolveNameSource = (
      descriptor: ModuleDescriptor,
      importedName: string,
      requested: { iconVariant: IconVariant; headless: boolean; sprite?: string },
    ): string | null => {
      const target = targetFor(descriptor, isColorIconName(importedName), requested);
      if (!target) return null;
      return atomicSourceFor(descriptor, importedName, target);
    };

    /**
     * Groups the properties of a destructuring object pattern by the atomic module
     * each imported name resolves to, preserving first-seen order. Each group's
     * `specs` are the emit-ready specifier strings (`'AddFilled'`, or
     * `'ArrowLeftRegular: arrow'` for a rename).
     *
     * Returns `null` (bail — leave the dynamic import untouched) when any property
     * isn't a plain, statically-known `name → binding` pair: rest elements,
     * computed/string keys, default values, or nested patterns.
     *
     * @example
     * // `{ AddFilled, AddRegular }`  — both live in the `add` atom
     * // → [{ source: '@fluentui/react-icons/svg/add', specs: ['AddFilled', 'AddRegular'] }]
     *
     * @example
     * // `{ AddFilled, ArrowLeftRegular: arrow }`  — different atoms, one renamed
     * // → [
     * //     { source: '@fluentui/react-icons/svg/add',        specs: ['AddFilled'] },
     * //     { source: '@fluentui/react-icons/svg/arrow-left', specs: ['ArrowLeftRegular: arrow'] },
     * //   ]
     *
     * @example
     * // `{ AddFilled, ...rest }`  → null   (rest element → bail)
     */
    const buildGroups = (
      objectPattern: ObjectPattern,
      descriptor: ModuleDescriptor,
      requested: { iconVariant: IconVariant; headless: boolean; sprite?: string },
    ): RewriteGroup[] | null => {
      const bySource = new Map<string, string[]>();
      const order: string[] = [];

      for (const prop of objectPattern.properties) {
        if (prop.type !== 'Property' || prop.computed || prop.kind !== 'init') return null;
        if (prop.key.type !== 'Identifier' || prop.value.type !== 'Identifier') return null;

        const importedName: string = prop.key.name;
        const localName: string = prop.value.name;
        const resolvedSource = resolveNameSource(descriptor, importedName, requested);
        if (resolvedSource === null) return null;

        const spec = importedName === localName ? importedName : `${importedName}: ${localName}`;
        if (!bySource.has(resolvedSource)) {
          bySource.set(resolvedSource, []);
          order.push(resolvedSource);
        }
        bySource.get(resolvedSource)!.push(spec);
      }

      if (order.length === 0) return null;
      return order.map((groupSource) => ({ source: groupSource, specs: bySource.get(groupSource)! }));
    };

    const importCallText = (groups: RewriteGroup[]): string =>
      groups.length === 1
        ? `import('${groups[0].source}')`
        : `Promise.all([${groups.map((g) => `import('${g.source}')`).join(', ')}])`;

    const patternText = (groups: RewriteGroup[]): string =>
      groups.length === 1
        ? `{ ${groups[0].specs.join(', ')} }`
        : `[${groups.map((g) => `{ ${g.specs.join(', ')} }`).join(', ')}]`;

    const visitor = new Visitor({
      // `const { A, B } = await import('barrel')`
      VariableDeclarator(node) {
        if (
          node.id.type !== 'ObjectPattern' ||
          node.init?.type !== 'AwaitExpression' ||
          node.init.argument.type !== 'ImportExpression'
        ) {
          return;
        }

        const importExpr = node.init.argument;
        if (importExpr.source.type !== 'Literal' || typeof importExpr.source.value !== 'string') return;

        const descriptor = getModuleDescriptor(parseImportSpecifier(importExpr.source.value).name);
        if (!descriptor) return;

        const groups = buildGroups(node.id, descriptor, requestedForSpecifier(importExpr.source.value));
        if (!groups) return;

        src.overwrite(node.start, node.end, `${patternText(groups)} = await ${importCallText(groups)}`);
        rewrittenImportStarts.add(importExpr.source.start);
      },

      // `import('barrel').then(({ A, B }) => …)`
      CallExpression(node) {
        if (
          node.callee.type !== 'MemberExpression' ||
          node.callee.computed ||
          node.callee.property.type !== 'Identifier' ||
          node.callee.property.name !== 'then' ||
          node.callee.object.type !== 'ImportExpression'
        ) {
          return;
        }

        const importExpr = node.callee.object;
        if (importExpr.source.type !== 'Literal' || typeof importExpr.source.value !== 'string') return;

        const descriptor = getModuleDescriptor(parseImportSpecifier(importExpr.source.value).name);
        if (!descriptor) return;

        const callback = node.arguments[0];
        if (!callback || (callback.type !== 'ArrowFunctionExpression' && callback.type !== 'FunctionExpression')) {
          return;
        }

        const param = callback.params[0];
        if (param?.type !== 'ObjectPattern') return;

        const groups = buildGroups(param, descriptor, requestedForSpecifier(importExpr.source.value));
        if (!groups) return;

        src.overwrite(importExpr.start, importExpr.end, importCallText(groups));
        // Multiple atoms resolve to an array, so the callback must destructure by
        // position instead of by name.
        if (groups.length > 1) {
          src.overwrite(param.start, param.end, patternText(groups));
        }
        rewrittenImportStarts.add(importExpr.source.start);
      },
    });

    visitor.visit(result.program);
  }

  // Dynamic imports of a barrel (`import('@fluentui/react-icons')`) cannot be
  // atomized: the returned namespace object is a runtime value whose usage is
  // not statically known, so the whole icon set ends up in the async chunk. We
  // can't rewrite it safely, but we can warn and point at the atomic escape
  // hatch (`import('@fluentui/react-icons/svg/add')`). Atomic and subpath
  // requests don't match a barrel descriptor, so they never warn.
  for (const dyn of dynamicImports) {
    const request = dyn.moduleRequest;
    if (!request) continue;

    // Skip imports we already atomized above (their usage was statically provable).
    if (rewrittenImportStarts.has(request.start)) continue;

    // Unlike static imports, oxc doesn't resolve a dynamic import's argument to a
    // specifier value — it's an arbitrary expression. Match the raw span against
    // each supported module's quoted spellings; this naturally ignores variables,
    // interpolated templates, and subpath/atomic requests (module names never
    // contain quotes).
    const raw = source.slice(request.start, request.end);
    const moduleName = SUPPORTED_MODULE_NAMES.find(
      (name) => raw === `'${name}'` || raw === `"${name}"` || raw === `\`${name}\``,
    );
    if (!moduleName) continue;

    pushDiagnostic({
      level: 'warning',
      message:
        `dynamic import of the "${moduleName}" barrel cannot be atomized, so the entire icon ` +
        `set will be bundled into the async chunk. Import an atomic path directly instead, ` +
        `e.g. import('${moduleName}/svg/add').`,
    });
  }

  return {
    code: src.toString(),
    map: src.generateMap({ hires: true }),
    diagnostics,
  };
}
