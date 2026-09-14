#!/usr/bin/env node
// @ts-check
/**
 * Runs the svg-sprite subsetting plugin fixtures against webpack and/or rspack.
 *
 * Usage: node test/run.js [options]
 *
 * Options:
 *   -b, --bundler   Which bundler to run: webpack | rspack | all (default: all)
 *   -h, --help      Show this message
 */
const { parseArgs } = require('node:util');

const BUNDLERS = /** @type {const} */ (['webpack', 'rspack']);

/** Every knob `make-configs.js` reads, so a scenario starts from a known environment. */
const SCENARIO_ENV_KEYS = [
  'SVG_SPRITE_MODE',
  'SVG_SPRITE_INJECT',
  'SVG_SPRITE_MANIFEST',
  'SVG_SPRITE_MERGED_FILENAME',
  'SVG_SPRITE_GROUPS',
];

/** @type {{ env: Record<string, string>, label: string }[]} */
const SCENARIOS = [
  { label: 'atomic', env: {} },
  {
    label: 'merged',
    env: { SVG_SPRITE_MODE: 'merged', SVG_SPRITE_MERGED_FILENAME: 'fluentui-react-icons.[contenthash].svg' },
  },
  { label: 'manifest', env: { SVG_SPRITE_MANIFEST: '1' } },
  { label: 'inline', env: { SVG_SPRITE_INJECT: 'inline' } },
  { label: 'reference', env: { SVG_SPRITE_MODE: 'merged', SVG_SPRITE_INJECT: 'reference' } },
  { label: 'groups', env: { SVG_SPRITE_GROUPS: '1', SVG_SPRITE_INJECT: 'inline' } },
  { label: 'groups-mixed', env: { SVG_SPRITE_GROUPS: 'mixed' } },
];

main();

async function main() {
  const options = processArgs();
  const selected = options.bundler === 'all' ? BUNDLERS : [options.bundler];

  for (const bundler of selected) {
    console.log(`\n=== Running svg-sprite fixtures with ${bundler} ===\n`);
    for (const scenario of SCENARIOS) {
      await runScenario(/** @type {'webpack' | 'rspack'} */ (bundler), scenario);
    }
    console.log(`\n✓ ${bundler} passed\n`);
  }
}

/**
 * @param {'webpack' | 'rspack'} bundler
 * @param {{ env: Record<string, string>, label: string }} scenario
 */
function runScenario(bundler, scenario) {
  // Every scenario owns the full set of knobs: set the ones it declares, clear the rest so
  // nothing leaks from the previous scenario in this process.
  for (const key of SCENARIO_ENV_KEYS) {
    if (key in scenario.env) {
      process.env[key] = scenario.env[key];
    } else {
      delete process.env[key];
    }
  }

  for (const file of ['./webpack.config.js', './rspack.config.js', './make-configs.js']) {
    delete require.cache[require.resolve(file)];
  }

  const compilerFactory = bundler === 'webpack' ? require('webpack') : require('@rspack/core').rspack;
  const config = require(`./${bundler}.config.js`);

  return new Promise((resolvePromise, rejectPromise) => {
    compilerFactory(config, (err, stats) => {
      if (err) {
        rejectPromise(err);
        return;
      }
      if (stats.hasErrors()) {
        console.error(stats.toString({ colors: true, preset: 'errors-only' }));
        rejectPromise(new Error(`${bundler}/${scenario.label} failed`));
        return;
      }
      resolvePromise();
    });
  });
}

function processArgs() {
  try {
    const { values } = parseArgs({
      options: {
        bundler: { type: 'string', short: 'b', default: 'all' },
        help: { type: 'boolean', short: 'h' },
      },
    });

    if (values.help) {
      printUsage();
      process.exit(0);
    }

    if (!['all', ...BUNDLERS].includes(/** @type {string} */ (values.bundler))) {
      throw new Error(`invalid --bundler "${values.bundler}", expected one of: all, ${BUNDLERS.join(', ')}`);
    }

    return { bundler: /** @type {'all' | 'webpack' | 'rspack'} */ (values.bundler) };
  } catch (err) {
    console.error(`Error parsing arguments: ${/** @type {Error} */ (err).message}`);
    printUsage();
    process.exit(1);
  }
}

function printUsage() {
  console.error(`
Usage: node test/run.js [options]

Options:
  -b, --bundler   Which bundler to run: webpack | rspack | all (default: all)
  -h, --help      Show this message
`);
}
