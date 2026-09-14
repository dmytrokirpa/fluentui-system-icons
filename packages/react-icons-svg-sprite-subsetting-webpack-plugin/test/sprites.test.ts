import { describe, expect, it } from 'vitest';

import { readFileSync } from 'fs';
import { resolve } from 'path';

import {
  extractSymbols,
  findDuplicatedSymbolIds,
  getModuleResourceQuery,
  groupSymbols,
  isValidSpriteGroupName,
  parseSpriteGroupFromQuery,
  resolveSpriteFilename,
  subsetSpriteSvg,
  wrapSymbolsInSvg,
} from '../src/sprites';

describe('getModuleResourceQuery', () => {
  it('prefers resourceQuery, then resource / userRequest / rawRequest', () => {
    expect(getModuleResourceQuery({ resourceQuery: '?sprite=critical' })).toBe('?sprite=critical');
    expect(
      getModuleResourceQuery({
        resource: '/icons/backpack.js?sprite=grid',
        userRequest: '@fluentui/react-icons/svg-sprite/backpack?sprite=stale',
      }),
    ).toBe('?sprite=grid');
    expect(
      getModuleResourceQuery({
        resource: '/icons/backpack.js',
        userRequest: '@fluentui/react-icons/svg-sprite/backpack?sprite=grid',
      }),
    ).toBe('?sprite=grid');
    expect(getModuleResourceQuery({ resource: '/icons/backpack.js' })).toBe('');
  });
});

const SAMPLE = wrapSymbolsInSvg([
  '<symbol id="BackpackFilled"><path d="a"/></symbol>',
  '<symbol id="BackpackRegular"><path d="b"/></symbol>',
  '<symbol id="CalculatorFilled"><path d="c"/></symbol>',
]);

describe('extractSymbols / subsetSpriteSvg', () => {
  it('extracts symbol ids in document order', () => {
    expect(extractSymbols(SAMPLE).map((s) => s.id)).toEqual(['BackpackFilled', 'BackpackRegular', 'CalculatorFilled']);
  });

  it('keeps only requested symbols', () => {
    const next = subsetSpriteSvg(SAMPLE, new Set(['BackpackFilled', 'CalculatorFilled']));
    const ids = extractSymbols(next).map((s) => s.id);
    expect(ids).toEqual(['BackpackFilled', 'CalculatorFilled']);
    expect(next).not.toContain('BackpackRegular');
  });
});

describe('groupSymbols', () => {
  const usage = () => {
    const critical = new Map<string, Set<string>>([['/sprites/backpack.svg', new Set(['BackpackFilled'])]]);
    const grid = new Map<string, Set<string>>([
      ['/sprites/backpack.svg', new Set(['BackpackFilled'])],
      ['/sprites/calculator.svg', new Set(['CalculatorFilled'])],
    ]);
    return new Map([
      ['critical', critical],
      ['grid', grid],
    ]);
  };

  it('keeps a shared symbol in every group that uses it and reports it', () => {
    const { groups, duplicatedIds } = groupSymbols(usage());
    expect(groups.get('critical')?.get('/sprites/backpack.svg')).toEqual(new Set(['BackpackFilled']));
    expect(groups.get('grid')?.get('/sprites/backpack.svg')).toEqual(new Set(['BackpackFilled']));
    expect(duplicatedIds).toEqual(['BackpackFilled']);
  });

  it('does not mutate the usage it was given', () => {
    const original = usage();
    groupSymbols(original).groups.get('grid')?.get('/sprites/backpack.svg')?.clear();
    expect(original.get('grid')?.get('/sprites/backpack.svg')).toEqual(new Set(['BackpackFilled']));
  });
});

describe('sprite group names', () => {
  it('accepts plain names and rejects anything that could escape the output directory', () => {
    expect(isValidSpriteGroupName('critical')).toBe(true);
    expect(isValidSpriteGroupName('route_grid-2')).toBe(true);
    expect(isValidSpriteGroupName('../../pwned')).toBe(false);
    expect(isValidSpriteGroupName('nested/group')).toBe(false);
    expect(isValidSpriteGroupName('-leading-dash')).toBe(false);
    expect(isValidSpriteGroupName('')).toBe(false);
  });

  it('ignores an unusable group in a resource query instead of building a filename from it', () => {
    expect(parseSpriteGroupFromQuery('?sprite=critical')).toBe('critical');
    expect(parseSpriteGroupFromQuery('?sprite=../../pwned')).toBeUndefined();
    expect(resolveSpriteFilename('[name].[contenthash].sprite.svg', { name: 'critical', contentHash: 'abc' })).toBe(
      'critical.abc.sprite.svg',
    );
  });
});

describe('bundler-api copies', () => {
  // The two plugins deliberately keep their own copy so neither depends on the other; this
  // fails the moment one copy is updated without the other.
  it('are identical apart from the sibling package named in the header', () => {
    const read = (pkg: string) =>
      readFileSync(resolve(__dirname, `../../${pkg}/src/bundler-api.ts`), 'utf8').replace(
        /^ \* Copied into this package and .*$/m,
        '',
      );

    expect(read('react-icons-svg-sprite-subsetting-webpack-plugin')).toBe(
      read('react-icons-font-subsetting-webpack-plugin'),
    );
  });
});

describe('findDuplicatedSymbolIds', () => {
  it('counts an id once per group even if it appears in several resources', () => {
    const groups = new Map([
      [
        'a',
        new Map([
          ['one.svg', new Set(['X'])],
          ['two.svg', new Set(['X'])],
        ]),
      ],
      ['b', new Map([['three.svg', new Set(['X', 'Y'])]])],
    ]);
    expect(findDuplicatedSymbolIds(groups)).toEqual(['X']);
  });
});
