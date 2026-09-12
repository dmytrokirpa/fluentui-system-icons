import { dirname, join } from 'path';

import { describe, expect, it } from 'vitest';

import {
  appendSpriteQuery,
  findMatchingRule,
  matchRuleCondition,
  parseImportSpecifier,
  resolveFileDefaults,
  resolveImportOverride,
  resolveRequestedTarget,
} from '../src/variants';

describe('parseImportSpecifier', () => {
  it('returns the bare name when there is no query', () => {
    expect(parseImportSpecifier('@fluentui/react-icons')).toEqual({
      name: '@fluentui/react-icons',
      query: new URLSearchParams(),
    });
  });

  it('splits variant and sprite queries', () => {
    const { name, query } = parseImportSpecifier('@fluentui/react-icons?variant=svg-sprite&sprite=critical');
    expect(name).toBe('@fluentui/react-icons');
    expect(query.get('variant')).toBe('svg-sprite');
    expect(query.get('sprite')).toBe('critical');
  });
});

describe('matchRuleCondition / findMatchingRule', () => {
  it('matches a substring, a regexp, and an any-of list', () => {
    expect(matchRuleCondition('Toolbar', '/src/Toolbar.tsx')).toBe(true);
    expect(matchRuleCondition(/routes\/grid/, '/src/routes/grid.tsx')).toBe(true);
    expect(matchRuleCondition(['Hero', /Toolbar/], '/src/Hero.tsx')).toBe(true);
    expect(matchRuleCondition(/Toolbar/, '/src/Hero.tsx')).toBe(false);
  });

  it('treats backslash and slash as the same path separator', () => {
    const win = 'C:\\repo\\node_modules\\@myorg\\app-nav\\src\\Nav.tsx';
    expect(matchRuleCondition('@myorg/app-nav', win)).toBe(true);
    expect(matchRuleCondition(/@myorg\/app-nav/, win)).toBe(true);
    expect(matchRuleCondition(/routes\/grid/, 'C:\\src\\routes\\grid\\page.tsx')).toBe(true);
    expect(matchRuleCondition('C:\\repo\\packages\\app-nav', 'C:/repo/packages/app-nav/src/Nav.tsx')).toBe(true);
    expect(matchRuleCondition(/@myorg\/app-nav/, '/repo/packages/app-shell/src/Nav.tsx')).toBe(false);
  });

  it('honors exclude and first-match-wins', () => {
    const rules = [
      { test: /Toolbar/, iconVariant: 'svg-sprite' as const, sprite: 'critical' },
      { test: /routes\/grid/, iconVariant: 'fonts' as const },
      { test: /grid/, exclude: /routes/, iconVariant: 'svg' as const },
    ];
    expect(findMatchingRule('/src/Toolbar.tsx', rules)?.sprite).toBe('critical');
    expect(findMatchingRule('/src/routes/grid.tsx', rules)?.iconVariant).toBe('fonts');
    expect(findMatchingRule('/src/other/grid.tsx', rules)?.iconVariant).toBe('svg');
  });

  it('matches files inside a named package from an app-level config', () => {
    const pkgRoot = dirname(require.resolve('@fluentui/react-icons-atomic-webpack-loader/package.json'));
    const viaResolve = join(pkgRoot, 'src', 'index.ts');
    const viaSourceTree = join(__dirname, '../src/index.ts');
    const rules = [
      {
        package: '@fluentui/react-icons-atomic-webpack-loader',
        iconVariant: 'svg-sprite' as const,
        sprite: 'critical',
      },
    ];
    expect(findMatchingRule(viaResolve, rules)?.sprite).toBe('critical');
    expect(findMatchingRule(viaSourceTree, rules)?.sprite).toBe('critical');
    expect(findMatchingRule('/tmp/other-app/src/index.ts', rules)).toBeUndefined();
  });
});

describe('resolveFileDefaults + import override', () => {
  it('layers import query over the first matching rule over the global default', () => {
    const file = resolveFileDefaults('/src/Toolbar.tsx', {
      iconVariant: 'svg',
      variantRules: [{ test: /Toolbar/, iconVariant: 'svg-sprite', sprite: 'critical' }],
    });
    expect(file).toEqual({ iconVariant: 'svg-sprite', headless: false, sprite: 'critical' });

    const override = resolveImportOverride(new URLSearchParams('variant=fonts&sprite=grid'));
    expect(resolveRequestedTarget(file, override)).toEqual({
      iconVariant: 'fonts',
      headless: false,
      sprite: 'grid',
    });
  });

  it('ignores unknown variant query values', () => {
    const override = resolveImportOverride(new URLSearchParams('variant=mask'));
    expect(override.iconVariant).toBeUndefined();
  });
});

describe('appendSpriteQuery', () => {
  it('appends sprite= only for svg-sprite atoms', () => {
    expect(appendSpriteQuery('@fluentui/react-icons/svg-sprite/add', 'critical', 'svg-sprite')).toBe(
      '@fluentui/react-icons/svg-sprite/add?sprite=critical',
    );
    expect(appendSpriteQuery('@fluentui/react-icons/svg/add', 'critical', 'svg')).toBe('@fluentui/react-icons/svg/add');
    expect(appendSpriteQuery('@fluentui/react-icons/svg-sprite/add', undefined, 'svg-sprite')).toBe(
      '@fluentui/react-icons/svg-sprite/add',
    );
  });
});
