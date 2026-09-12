import { describe, expect, it } from 'vitest';

import {
  extractSymbols,
  findDuplicatedSymbolIds,
  getModuleResourceQuery,
  groupSymbols,
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

  it('duplicates shared symbols by default', () => {
    const { groups, duplicatedIds } = groupSymbols(usage(), 'duplicate');
    expect(groups.get('critical')?.get('/sprites/backpack.svg')).toEqual(new Set(['BackpackFilled']));
    expect(groups.get('grid')?.get('/sprites/backpack.svg')).toEqual(new Set(['BackpackFilled']));
    expect(duplicatedIds).toEqual(['BackpackFilled']);
  });

  it('hoists symbols that live in an inlined group out of the others', () => {
    const { groups, duplicatedIds } = groupSymbols(usage(), 'hoist', new Set(['critical']));
    expect(groups.get('critical')?.get('/sprites/backpack.svg')).toEqual(new Set(['BackpackFilled']));
    expect(groups.get('grid')?.get('/sprites/backpack.svg')?.size).toBe(0);
    expect(groups.get('grid')?.get('/sprites/calculator.svg')).toEqual(new Set(['CalculatorFilled']));
    expect(duplicatedIds).toEqual([]);
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
