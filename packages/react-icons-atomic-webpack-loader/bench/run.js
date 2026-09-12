// @ts-check
/**
 * Builds the demo / bench profiles on webpack and rspack and prints size metrics.
 *
 * Usage: node bench/run.js [--bundler webpack|rspack|all] [--profile svg|fonts|sprite|mixed|all]
 */
const { parseArgs } = require('node:util');
const { performance } = require('node:perf_hooks');
const { gzipSync } = require('node:zlib');
const { mkdirSync, writeFileSync, readFileSync, existsSync } = require('node:fs');
const { dirname, join, resolve } = require('node:path');

const BUNDLERS = /** @type {const} */ (['webpack', 'rspack']);
const PROFILES = /** @type {const} */ (['svg', 'fonts', 'sprite', 'mixed']);

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const options = processArgs();
  const bundlers = options.bundler === 'all' ? BUNDLERS : [options.bundler];
  const profiles = options.profile === 'all' ? PROFILES : [options.profile];

  writeDemoSources();

  /** @type {object[]} */
  const rows = [];

  for (const bundler of bundlers) {
    for (const profile of profiles) {
      rows.push(await buildOnce(bundler, profile));
    }
  }

  console.table(rows);
  const out = resolve(__dirname, 'dist/metrics.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(rows, null, 2));
  console.log(`Wrote ${out}`);
}

function writeDemoSources() {
  const srcDir = resolve(__dirname, 'demo/src');
  mkdirSync(join(srcDir, 'routes'), { recursive: true });

  writeFileSync(
    join(srcDir, 'Hero.js'),
    `export function Hero() {
  return (
    <section>
      <svg width="64" height="64" viewBox="0 0 20 20" fill="#0f6cbd" aria-hidden="true">
        <circle cx="10" cy="10" r="8" />
      </svg>
    </section>
  );
}
`,
  );

  writeFileSync(
    join(srcDir, 'Toolbar.js'),
    `import { BackpackFilled, CalculatorFilled } from '@fluentui/react-icons';
export function Toolbar() {
  return (
    <nav onMouseEnter={() => {}}>
      <BackpackFilled />
      <CalculatorFilled />
    </nav>
  );
}
`,
  );

  writeFileSync(
    join(srcDir, 'routes/grid.js'),
    `import { BackpackFilled, CalculatorFilled } from '@fluentui/react-icons';
const KINDS = [BackpackFilled, CalculatorFilled];
export default function Grid() {
  const rows = Array.from({ length: 300 }, (_, i) => i);
  return (
    <div>
      {rows.map((row) => (
        <div key={row}>
          {KINDS.map((Icon, col) => (
            <Icon key={col} />
          ))}
        </div>
      ))}
    </div>
  );
}
`,
  );

  writeFileSync(
    join(srcDir, 'index.js'),
    `import { Hero } from './Hero';
import { Toolbar } from './Toolbar';
export function App() {
  return (
    <main>
      <Hero />
      <Toolbar />
      <button onClick={() => import('./routes/grid')}>Load grid</button>
    </main>
  );
}
console.log(App);
`,
  );
}

/**
 * @param {'webpack' | 'rspack'} bundler
 * @param {'svg' | 'fonts' | 'sprite' | 'mixed'} profile
 */
async function buildOnce(bundler, profile) {
  const compilerFactory = bundler === 'webpack' ? require('webpack') : require('@rspack/core').rspack;
  const config = makeConfig(bundler, profile);
  const started = performance.now();

  const stats = await new Promise((resolvePromise, rejectPromise) => {
    compilerFactory(config, (err, result) => {
      if (err) {
        rejectPromise(err);
        return;
      }
      if (result.hasErrors()) {
        rejectPromise(new Error(result.toString({ colors: false, preset: 'errors-only' })));
        return;
      }
      resolvePromise(result);
    });
  });

  const buildMs = Math.round(performance.now() - started);
  const outputPath = config.output.path;
  const assets = stats.toJson({ all: false, assets: true }).assets ?? [];
  const jsAssets = assets.filter((a) => a.name.endsWith('.js'));
  let jsGzip = 0;
  for (const asset of jsAssets) {
    const file = join(outputPath, asset.name);
    if (existsSync(file)) {
      jsGzip += gzipSync(readFileSync(file)).length;
    }
  }

  const htmlPath = join(outputPath, 'index.html');
  const htmlBytes = existsSync(htmlPath) ? readFileSync(htmlPath).length : 0;
  const initialJs = jsAssets
    .filter((a) => !a.chunkNames || a.chunkNames.includes('main'))
    .reduce((n, a) => n + (a.size || 0), 0);

  return {
    bundler,
    profile,
    buildMs,
    jsGzip,
    htmlBytes,
    initialJs,
    assetCount: assets.length,
  };
}

/**
 * @param {'webpack' | 'rspack'} bundler
 * @param {'svg' | 'fonts' | 'sprite' | 'mixed'} profile
 */
function makeConfig(bundler, profile) {
  const HtmlPlugin = bundler === 'webpack' ? require('html-webpack-plugin') : require('@rspack/core').HtmlRspackPlugin;
  const loader = require.resolve('@fluentui/react-icons-atomic-webpack-loader');
  const SpritePlugin = require('@fluentui/react-icons-svg-sprite-subsetting-webpack-plugin').default;
  const mockRoot = resolve(
    __dirname,
    '../../react-icons-svg-sprite-subsetting-webpack-plugin/test/__mock__/react-icons/lib/atoms/svg-sprite',
  );

  /** @type {object} */
  const loaderOptions = { iconVariant: profile === 'fonts' ? 'fonts' : profile === 'sprite' ? 'svg-sprite' : 'svg' };
  if (profile === 'mixed') {
    loaderOptions.iconVariant = 'svg';
    loaderOptions.variantRules = [
      { test: /Toolbar/, iconVariant: 'svg-sprite', sprite: 'critical' },
      { test: /routes\/grid/, iconVariant: 'svg-sprite', sprite: 'grid' },
    ];
  }

  /** @type {object} */
  const spriteOptions =
    profile === 'mixed'
      ? { sprites: { critical: { inline: true }, grid: { inline: false, prefetch: true } } }
      : profile === 'sprite'
        ? { mode: 'merged', injectSpritesInTemplates: { mode: 'inline' } }
        : { mode: 'atomic' };

  return {
    context: resolve(__dirname, 'demo'),
    mode: 'production',
    entry: { main: './src/index.js' },
    output: {
      path: resolve(__dirname, 'dist', `${bundler}-${profile}`),
      filename: '[name].js',
      clean: true,
    },
    resolve: {
      alias: {
        '@fluentui/react-icons/svg-sprite/backpack': join(mockRoot, 'backpack.js'),
        '@fluentui/react-icons/svg-sprite/calculator': join(mockRoot, 'calculator.js'),
        react: require.resolve('react'),
        'react-dom': require.resolve('react-dom'),
      },
      extensions: ['.js', '.jsx', '.ts', '.tsx'],
    },
    externals: profile === 'fonts' || profile === 'svg' ? [/^@fluentui\/react-icons/] : [],
    module: {
      rules: [
        {
          test: /\.jsx?$/,
          enforce: 'pre',
          use: [{ loader, options: loaderOptions }],
        },
        {
          test: /\.jsx?$/,
          exclude: /node_modules/,
          use: [
            {
              loader: 'ts-loader',
              options: { transpileOnly: true, compilerOptions: { jsx: 'react-jsx', allowJs: true } },
            },
          ],
        },
        {
          test: /\.svg$/,
          type: 'asset/resource',
        },
      ],
    },
    plugins: [new SpritePlugin(spriteOptions), new HtmlPlugin({ filename: 'index.html', chunks: ['main'] })],
  };
}

function processArgs() {
  const { values } = parseArgs({
    options: {
      bundler: { type: 'string', short: 'b', default: 'all' },
      profile: { type: 'string', short: 'p', default: 'mixed' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log('Usage: node bench/run.js [--bundler webpack|rspack|all] [--profile svg|fonts|sprite|mixed|all]');
    process.exit(0);
  }
  return {
    bundler: /** @type {'all' | 'webpack' | 'rspack'} */ (values.bundler),
    profile: /** @type {'all' | 'svg' | 'fonts' | 'sprite' | 'mixed'} */ (values.profile),
  };
}
