/**
 * Generates a module that exports the public URL of a named sprite group.
 *
 * Query: `?group=grid&inline=1`
 *
 * Inline groups export an empty string (symbols live in the document). Other
 * groups export `__webpack_public_path__` plus a placeholder that the plugin
 * replaces with the emitted filename once the content hash is known.
 */

import { spriteUrlPlaceholder } from '../sprites';

interface SpriteUrlLoaderContext {
  resourceQuery: string;
  cacheable(): void;
}

function spriteUrlLoader(this: SpriteUrlLoaderContext): string {
  this.cacheable();
  const query = this.resourceQuery.startsWith('?') ? this.resourceQuery.slice(1) : this.resourceQuery;
  const params = new URLSearchParams(query);
  const group = params.get('group') || 'main';
  const inline = params.get('inline') === '1';

  if (inline) {
    return 'export default "";\n';
  }

  // `__webpack_public_path__` is rewritten by webpack and rspack into the runtime publicPath.
  return `export default __webpack_public_path__ + ${JSON.stringify(spriteUrlPlaceholder(group))};\n`;
}

export = spriteUrlLoader;
