// @ts-check
const { default: FluentUIReactIconsSvgSpriteSubsettingPlugin } = require('../lib/');

/**
 * @param {string} label
 * @param {() => void} fn
 */
function expectThrow(label, fn) {
  try {
    fn();
  } catch (error) {
    if (!(error instanceof Error)) {
      throw new Error(`${label}: expected Error instance`);
    }
    return;
  }
  throw new Error(`${label}: expected constructor to throw`);
}

expectThrow('atomic mode mergedSpriteFilename', () => {
  new FluentUIReactIconsSvgSpriteSubsettingPlugin({
    mode: 'atomic',
    mergedSpriteFilename: 'fluentui-react-icons.svg',
  });
});

expectThrow('invalid merged filename placeholder', () => {
  new FluentUIReactIconsSvgSpriteSubsettingPlugin({
    mode: 'merged',
    mergedSpriteFilename: 'fluentui-react-icons.[name].svg',
  });
});

expectThrow('invalid sprite group name', () => {
  new FluentUIReactIconsSvgSpriteSubsettingPlugin({
    sprites: { '../../pwned': { inline: false } },
  });
});

expectThrow('invalid sprite group filename placeholder', () => {
  new FluentUIReactIconsSvgSpriteSubsettingPlugin({
    sprites: { critical: { filename: 'critical.[chunkhash].sprite.svg' } },
  });
});

expectThrow('unknown option', () => {
  new FluentUIReactIconsSvgSpriteSubsettingPlugin(
    /** @type {any} */ ({ sharedSymbols: 'hoist' }),
  );
});

console.log('svg-sprite subsetting validation tests passed');
