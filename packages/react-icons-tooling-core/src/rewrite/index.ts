export type { IconVariant, ModuleDescriptor, VariantResolution } from './modules';
export {
  DEFAULT_SAFETY_VARIANT,
  MODULES,
  SUPPORTED_MODULE_NAMES,
  getModuleDescriptor,
  isColorIconName,
  resolveColorVariant,
  resolveModuleHeadless,
  resolveModuleVariant,
} from './modules';
export type { Diagnostic, TransformResult, TransformOptions } from './transform';
export { transformSource } from './transform';
