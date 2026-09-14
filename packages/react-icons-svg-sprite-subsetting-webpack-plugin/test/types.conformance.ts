// Type-level conformance test — no runtime behaviour, checked by `tsc` only.
//
// Asserts that the hand-maintained bundler interfaces in `src/bundler-api.ts` remain supertypes of
// the real webpack and rspack types. If either bundler changes a signature we depend on, this fails
// to compile, which is the drift protection that justifies maintaining those interfaces by hand.
import type * as webpack from 'webpack';
import type * as rspack from '@rspack/core';

import type { BundlerCompilation, BundlerCompiler, BundlerPlugin } from '../src/bundler-api';
import FluentUIReactIconsSvgSpriteSubsettingPlugin from '../src/index';

/** Fails to compile unless `Actual` is assignable to `Expected`. */
type AssertAssignable<Expected, Actual extends Expected> = Actual;

// Contravariance: `apply(compiler: BundlerCompiler)` is only sound if every real compiler is a
// BundlerCompiler. This is what makes `implements` work without casting.
type WebpackCompilerConforms = AssertAssignable<BundlerCompiler, webpack.Compiler>;
type RspackCompilerConforms = AssertAssignable<BundlerCompiler, rspack.Compiler>;

// Checked directly rather than through `hooks.compilation.tap`, whose parameters are bivariant and
// so would accept a `BundlerCompilation` the real compilations do not satisfy.
type WebpackCompilationConforms = AssertAssignable<BundlerCompilation, webpack.Compilation>;
type RspackCompilationConforms = AssertAssignable<BundlerCompilation, rspack.Compilation>;

// The plugin must remain usable in both bundlers' `plugins` arrays.
type IsWebpackPlugin = AssertAssignable<
  webpack.WebpackPluginInstance,
  FluentUIReactIconsSvgSpriteSubsettingPlugin
>;
type IsRspackPlugin = AssertAssignable<rspack.RspackPluginInstance, FluentUIReactIconsSvgSpriteSubsettingPlugin>;

// The exported plugin contract is satisfied by the class.
type ImplementsContract = AssertAssignable<BundlerPlugin, FluentUIReactIconsSvgSpriteSubsettingPlugin>;

declare const webpackCompiler: webpack.Compiler;
declare const rspackCompiler: rspack.Compiler;

// No cast at the callsite: real compilers are accepted directly.
new FluentUIReactIconsSvgSpriteSubsettingPlugin().apply(webpackCompiler);
new FluentUIReactIconsSvgSpriteSubsettingPlugin().apply(rspackCompiler);

const webpackConfig: webpack.Configuration = { plugins: [new FluentUIReactIconsSvgSpriteSubsettingPlugin()] };
const rspackConfig: rspack.Configuration = { plugins: [new FluentUIReactIconsSvgSpriteSubsettingPlugin()] };

// `ReplaceSource` is optional on the hand-maintained surface, so both bundlers must still
// supply a constructor that accepts a source and patches a span.
type WebpackSources = webpack.Compiler['webpack']['sources'];
type RspackSources = rspack.Compiler['rspack']['sources'];
type WebpackHasReplaceSource = AssertAssignable<Required<BundlerCompiler['webpack']>['sources'], WebpackSources>;
type RspackHasReplaceSource = AssertAssignable<Required<BundlerCompiler['webpack']>['sources'], RspackSources>;

export type {
  WebpackCompilerConforms,
  RspackCompilerConforms,
  WebpackCompilationConforms,
  RspackCompilationConforms,
  IsWebpackPlugin,
  IsRspackPlugin,
  ImplementsContract,
  WebpackHasReplaceSource,
  RspackHasReplaceSource,
};
export { webpackConfig, rspackConfig };
