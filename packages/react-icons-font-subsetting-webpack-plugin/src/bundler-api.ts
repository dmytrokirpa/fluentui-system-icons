/**
 * Hand-maintained description of the bundler APIs the font and sprite plugins touch.
 *
 * Deliberately not `import type ... from 'webpack'`: both bundlers are optional peers, so
 * referencing webpack's types here would leak into the generated `.d.ts` and break type-checking
 * for consumers who only installed `@rspack/core`.
 *
 * Every member is intentionally *wider* than the corresponding webpack and rspack type, so both
 * real compilers remain assignable to `BundlerCompiler`. That contravariance is what lets `apply()`
 * take a typed parameter instead of `unknown`. Conformance tests in the plugin packages fail to
 * compile if either bundler ever drifts out of these bounds.
 *
 * Copied into this package and `@fluentui/react-icons-svg-sprite-subsetting-webpack-plugin`
 * so neither plugin depends on the other. Keep the two copies aligned; this surface is too
 * small to justify a fourth published package.
 */

export interface BundlerSource {
  source(): string | Buffer;
}

/** `type` is present on both bundlers' modules; `resource` only on normal modules. */
export interface BundlerModule {
  readonly type?: string;
  readonly resource?: string;
  readonly resourceQuery?: string;
  /** Original request, often still carries `?sprite=` when `resource` does not. */
  readonly userRequest?: string;
  readonly rawRequest?: string;
  /** Widened so webpack/rspack `BuildInfo` remains assignable. */
  readonly buildInfo?: any;
  originalSource?(): BundlerSource | null | undefined;
}

export interface BundlerNormalModule extends BundlerModule {
  readonly resource: string;
}

export interface BundlerModuleGraph {
  /** webpack passes a `RuntimeSpec`; rspack requires explicit runtime names. */
  getUsedExports(
    module: BundlerModule,
    runtime: string | string[] | ReadonlySet<string> | undefined,
  ): ReadonlySet<string> | readonly string[] | boolean | null;
  /** Optional: exposed to rspack's JS API only in 2.1.0, so absent on the supported 2.0.x floor. */
  getProvidedExports?(module: BundlerModule): readonly string[] | boolean | null;
  /** Used by the sprite plugin to recover the issuing module's `resourceQuery`. */
  getParentModule?(dependency: unknown): BundlerModule | null | undefined;
}

export interface BundlerAsset {
  name: string;
  source: BundlerSource;
  info?: { sourceFilename?: string };
}

/** webpack's `RuntimeSpec` is `string | SortableSet<string> | undefined`; rspack's is a `Set<string>`. */
export interface BundlerChunk {
  runtime?: string | ReadonlySet<string>;
  hasRuntime?(): boolean;
}

export interface BundlerEntrypoint {
  chunks: Iterable<BundlerChunk>;
  getRuntimeChunk?(): BundlerChunk | undefined | null;
  runtime?: string | ReadonlySet<string>;
}

export interface BundlerChunkGraph {
  getModuleChunksIterable(module: BundlerModule): Iterable<BundlerChunk>;
}

export interface BundlerResolveData {
  request?: string;
  context?: string;
  contextInfo?: { issuer?: string };
  dependencies?: readonly unknown[];
}

export interface BundlerNormalModuleFactory {
  hooks: {
    beforeResolve: {
      tap(name: string, fn: (resolveData: BundlerResolveData) => void): void;
    };
  };
}

export interface BundlerCompilation {
  hooks: {
    processAssets: {
      tap?(options: { name: string; stage: number }, fn: () => void): void;
      tapPromise(options: { name: string; stage: number }, fn: () => Promise<void>): void;
    };
  };
  modules: Iterable<BundlerModule>;
  chunks: Iterable<BundlerChunk>;
  moduleGraph: BundlerModuleGraph;
  chunkGraph?: BundlerChunkGraph;
  entrypoints: ReadonlyMap<string, BundlerEntrypoint | unknown>;
  warnings: any[];
  errors: any[];
  hash?: string | null;
  fullHash?: string | null;
  outputOptions: any;
  getAsset(name: string): BundlerAsset | undefined | void;
  getAssets(): readonly BundlerAsset[];
  /**
   * `any` is load-bearing: both bundlers accept a full `webpack-sources` `Source` here, and only
   * `any` is assignable to that, which is what keeps real compilers assignable to this interface.
   * The value passed is always one the bundler itself constructed via `sources.RawSource`.
   */
  updateAsset(name: string, source: any): void;
  emitAsset(name: string, source: any): void;
}

export interface BundlerCompiler {
  context: string;
  /**
   * Widened to `any` so webpack's `OptimizationNormalized` / rspack's
   * `RspackOptionsNormalized` remain assignable (they have no string index signature).
   */
  options?: any;
  /** rspack aliases this to its own namespace, which is why no bundler is imported at runtime. */
  webpack: {
    Compilation: {
      PROCESS_ASSETS_STAGE_OPTIMIZE: number;
      PROCESS_ASSETS_STAGE_OPTIMIZE_INLINE?: number;
    };
    sources: {
      RawSource: new (value: string | Buffer, ...rest: any[]) => BundlerSource;
      /**
       * Optional: lets the sprite plugin patch an asset without discarding its source map.
       * The argument is always a source the bundler itself produced, hence `any`.
       */
      ReplaceSource?: new (source: any, name?: string) => BundlerSource & {
        replace(start: number, end: number, value: string, name?: string): void;
      };
    };
    util?: {
      createHash(algorithm: any): { update(data: string | Buffer): void; digest(encoding: string): string | Buffer };
    };
  };
  hooks: {
    compilation: {
      tap(
        name: string,
        fn: (compilation: BundlerCompilation, params?: { normalModuleFactory?: BundlerNormalModuleFactory }) => void,
      ): void;
    };
    normalModuleFactory: {
      tap(name: string, fn: (normalModuleFactory: BundlerNormalModuleFactory) => void): void;
    };
  };
}

/** The shape both bundlers require of a plugin instance. */
export interface BundlerPlugin {
  apply(compiler: BundlerCompiler): void;
}

export type BundlerRawSource = BundlerCompiler['webpack']['sources']['RawSource'];

/**
 * rspack modules are proxies over Rust objects and are never instances of webpack's `NormalModule`,
 * so presence of `resource` is used as the portable discriminator.
 */
export function isNormalModule(m: BundlerModule): m is BundlerNormalModule {
  return typeof m.resource === 'string';
}

export function isRspack(compiler: BundlerCompiler): boolean {
  return 'rspack' in compiler;
}
