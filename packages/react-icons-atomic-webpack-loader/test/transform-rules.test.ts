import { describe, expect, it } from 'vitest';

import { transformSource } from '../src/transform';

describe('transformSource variantRules + import queries', () => {
  it('leaves existing svg rewrites unchanged when no rules are set', () => {
    const { code } = transformSource(`import { AddFilled } from '@fluentui/react-icons';`, {
      iconVariant: 'svg',
      path: 'input.js',
    });
    expect(code).toBe(`import { AddFilled } from '@fluentui/react-icons/svg/add';`);
  });

  it('applies the first matching variantRule, including a sprite group', () => {
    const { code } = transformSource(`import { AddFilled } from '@fluentui/react-icons';`, {
      iconVariant: 'svg',
      path: '/app/src/Toolbar.tsx',
      variantRules: [{ test: /Toolbar/, iconVariant: 'svg-sprite', sprite: 'critical' }],
    });
    expect(code).toBe(`import { AddFilled } from '@fluentui/react-icons/svg-sprite/add?sprite=critical';`);
  });

  it('lets an import query override a matching rule', () => {
    const { code } = transformSource(`import { AddFilled } from '@fluentui/react-icons?variant=fonts';`, {
      iconVariant: 'svg',
      path: '/app/src/Toolbar.tsx',
      variantRules: [{ test: /Toolbar/, iconVariant: 'svg-sprite', sprite: 'critical' }],
    });
    expect(code).toBe(`import { AddFilled } from '@fluentui/react-icons/fonts/add';`);
  });

  it('honors ?sprite= on a barrel import', () => {
    const { code } = transformSource(
      `import { AddFilled } from '@fluentui/react-icons?variant=svg-sprite&sprite=grid';`,
      { iconVariant: 'svg', path: 'input.js' },
    );
    expect(code).toBe(`import { AddFilled } from '@fluentui/react-icons/svg-sprite/add?sprite=grid';`);
  });

  it('does not apply a later overlapping rule', () => {
    const { code } = transformSource(`import { AddFilled } from '@fluentui/react-icons';`, {
      iconVariant: 'svg',
      path: '/app/src/routes/grid.tsx',
      variantRules: [
        { test: /routes\/grid/, iconVariant: 'fonts' },
        { test: /grid/, iconVariant: 'svg-sprite', sprite: 'grid' },
      ],
    });
    expect(code).toBe(`import { AddFilled } from '@fluentui/react-icons/fonts/add';`);
  });
});
