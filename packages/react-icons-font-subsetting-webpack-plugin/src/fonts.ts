import { extname, resolve } from 'path';
import { readFile } from 'fs/promises';
import subsetFont from 'subset-font';

import type { BundlerAsset, BundlerCompilation } from './bundler-api';

export const FONT_FILES_BASE_NAMES = [
  'FluentSystemIcons-Filled',
  'FluentSystemIcons-Resizable',
  'FluentSystemIcons-Regular',
  'FluentSystemIcons-Light',
] as const;

export const FONT_EXTENSIONS = ['.ttf', '.woff', '.woff2'] as const;

/**
 * Match both chunk files and atomic font imports, for the standard (Griffel)
 * and headless APIs:
 * - lib/fonts/sizedIcons/chunk-0.js        (chunk-based, standard)
 * - lib/atoms/fonts/access-time.js         (atomic imports, standard)
 * - lib/atoms/headless-fonts/access-time.js (atomic imports, headless)
 * - lib-cjs/atoms/fonts/access-time.cjs    (CommonJS output)
 */
export const REACT_ICONS_FONT_MODULE_IMPORT_PATTERN =
  /react-icons[\/\\]lib(-cjs)?[\/\\](fonts[\/\\](sizedIcons|icons)[\/\\]chunk-\d+|atoms[\/\\](headless-)?fonts[\/\\][\w-]+)\.c?js$/;

export type FontTargetFormat = 'sfnt' | 'woff' | 'woff2';

export function getTargetFormat(assetName: string): FontTargetFormat {
  switch (extname(assetName)) {
    case '.woff':
      return 'woff';
    case '.woff2':
      return 'woff2';
    default:
      return 'sfnt';
  }
}

/**
 * Builds the subset input string from used icon export names and a codepoint table.
 * Unknown names are skipped so a stale export never throws.
 */
export function codepointsToSubsetText(codepointMap: Record<string, number>, usedExports: Iterable<string>): string {
  let subsetText = '';
  for (const glyphName of usedExports) {
    const codepoint = codepointMap[glyphName];
    if (codepoint !== undefined) {
      subsetText += String.fromCodePoint(codepoint);
    }
  }
  return subsetText;
}

export async function subsetFontAsset(
  source: Buffer,
  subsetText: string,
  targetFormat: FontTargetFormat,
): Promise<Buffer> {
  return subsetFont(source, subsetText, { targetFormat });
}

export async function loadFontCodepoints(utilsFontsFolder: string): Promise<Record<string, Record<string, number>>> {
  return Object.fromEntries(
    await Promise.all(
      FONT_FILES_BASE_NAMES.map(async (fontBaseName) => [
        fontBaseName,
        JSON.parse(await readFile(resolve(utilsFontsFolder, `${fontBaseName}.json`), 'utf8')),
      ]),
    ),
  );
}

/** An emitted font asset paired with the codepoint table of the package it came from. */
export interface FontAssetCodepoints {
  assetName: string;
  codepoints: Record<string, number>;
}

/**
 * Maps emitted font assets back to their codepoint tables through `AssetInfo.sourceFilename`
 * (the originating file, relative to the compiler context) rather than the module's `buildInfo`,
 * which rspack leaves empty for asset modules.
 */
export function matchFontAssetsToCodepoints(
  assets: readonly BundlerAsset[],
  compilerContext: string,
  fontPaths: Map<string, Record<string, number>>,
): FontAssetCodepoints[] {
  const result: FontAssetCodepoints[] = [];

  for (const { name: assetName, info } of assets) {
    const sourceFilename = info?.sourceFilename;
    if (!sourceFilename) {
      continue;
    }

    const codepointsForAsset = fontPaths.get(resolve(compilerContext, sourceFilename));
    if (codepointsForAsset) {
      result.push({ assetName, codepoints: codepointsForAsset });
    }
  }

  return result;
}

export async function getFontAssetsAndCodepoints(
  pkgLibPath: string,
  compilation: BundlerCompilation,
  context: string,
): Promise<FontAssetCodepoints[]> {
  const utilsFontsFolder = resolve(pkgLibPath, 'utils/fonts');
  const codepoints = await loadFontCodepoints(utilsFontsFolder);
  const fontPaths = new Map<string, Record<string, number>>(
    FONT_FILES_BASE_NAMES.flatMap((fontBaseName) =>
      FONT_EXTENSIONS.map((ext) => [resolve(utilsFontsFolder, `${fontBaseName}${ext}`), codepoints[fontBaseName]]),
    ),
  );

  return matchFontAssetsToCodepoints(compilation.getAssets(), context, fontPaths);
}
