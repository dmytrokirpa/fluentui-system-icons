// Type-level conformance test — no runtime behaviour, checked by `tsc` only.
//
// Asserts that the hand-maintained `AtomicLoaderContext` remains a supertype of the real webpack
// and rspack loader contexts. If either bundler changes a member the loader uses, this fails to
// compile, which is the drift protection that justifies maintaining the interface by hand.
import type * as webpack from 'webpack';
import type * as rspack from '@rspack/core';

import type { AtomicLoaderContext, FluentIconsAtomicImportLoaderOptions } from '../src/index';

/** Fails to compile unless `Actual` is assignable to `Expected`. */
type AssertAssignable<Expected, Actual extends Expected> = Actual;

// The loader is invoked by the bundler with its own context as `this`, so every real loader
// context must satisfy the maintained interface.
type WebpackContextConforms = AssertAssignable<
  AtomicLoaderContext,
  webpack.LoaderContext<FluentIconsAtomicImportLoaderOptions>
>;
type RspackContextConforms = AssertAssignable<
  AtomicLoaderContext,
  rspack.LoaderContext<FluentIconsAtomicImportLoaderOptions>
>;

// The published `query.d.ts` shim has to make the opt-in import queries resolve. This is a
// plain import rather than a type-level assertion because the failure mode it guards against
// (the shim becoming a module, so its `declare module` blocks turn into augmentations) shows
// up as `TS2307` on the import itself.
import { AddFilled } from '@fluentui/react-icons?variant=svg-sprite&sprite=critical';
import { CalendarFilled } from '@fluentui/react-icons?variant=fonts';

type QueriedImportsResolve = AssertAssignable<typeof AddFilled, typeof CalendarFilled>;

export type { WebpackContextConforms, RspackContextConforms, QueriedImportsResolve };
