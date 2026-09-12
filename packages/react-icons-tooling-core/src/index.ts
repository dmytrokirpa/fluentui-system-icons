export type {
  IconVariant,
  ModuleDescriptor,
  VariantResolution,
  Diagnostic,
  TransformResult,
  TransformOptions,
} from './rewrite';
export {
  DEFAULT_SAFETY_VARIANT,
  MODULES,
  SUPPORTED_MODULE_NAMES,
  getModuleDescriptor,
  isColorIconName,
  resolveColorVariant,
  resolveModuleHeadless,
  resolveModuleVariant,
  transformSource,
} from './rewrite';

export type {
  RuleCondition,
  VariantRule,
  ImportSpecifierParts,
  FileVariantDefaults,
  ImportVariantOverride,
} from './variants';
export {
  ICON_VARIANTS,
  DEFAULT_SPRITE_GROUP,
  parseImportSpecifier,
  isIconVariant,
  matchRuleCondition,
  matchesRule,
  findMatchingRule,
  resolveFileDefaults,
  resolveImportOverride,
  resolveRequestedTarget,
  appendSpriteQuery,
} from './variants';

export type { FontTargetFormat, FontAssetCodepoints } from './fonts';
export {
  FONT_FILES_BASE_NAMES,
  FONT_EXTENSIONS,
  REACT_ICONS_FONT_MODULE_IMPORT_PATTERN,
  getTargetFormat,
  codepointsToSubsetText,
  subsetFontAsset,
  loadFontCodepoints,
  matchFontAssetsToCodepoints,
  getFontAssetsAndCodepoints,
} from './fonts';

export type {
  SvgSpriteOptimizationMode,
  SharedSymbolsPolicy,
  SpriteGroupOptions,
  SpriteSymbol,
  SpriteGroupUsage,
} from './sprites';
export {
  SYMBOL_ELEMENT_PATTERN,
  REACT_ICONS_SVG_SPRITE_JS_MODULE_IMPORT_PATTERN,
  ATOMS_SVG_SPRITE_DIR_PATTERN,
  extractSymbols,
  wrapSymbolsInSvg,
  subsetSpriteSvg,
  mergeSprites,
  buildMergedSprite,
  groupSymbols,
  findDuplicatedSymbolIds,
  parseSpriteGroupFromQuery,
  resourceQueryFromResource,
  getModuleResourceQuery,
  resolveSpriteGroup,
  assertValidSpriteFilename,
  resolveSpriteFilename,
  createContentHash,
  stripXmlDeclaration,
  injectIntoBody,
  injectIntoHead,
  getReferencedSpritePath,
  getExportNameToSymbolIdMap,
  getUsedSymbolIds,
  collectSortedIds,
  combineSpriteUsage,
  SPRITE_URL_PLACEHOLDER_PREFIX,
  spriteUrlPlaceholder,
} from './sprites';

export type {
  BundlerSource,
  BundlerModule,
  BundlerNormalModule,
  BundlerModuleGraph,
  BundlerAsset,
  BundlerChunk,
  BundlerEntrypoint,
  BundlerChunkGraph,
  BundlerResolveData,
  BundlerNormalModuleFactory,
  BundlerCompilation,
  BundlerCompiler,
  BundlerPlugin,
  BundlerRawSource,
} from './bundler-api';
export { isNormalModule, isRspack } from './bundler-api';
