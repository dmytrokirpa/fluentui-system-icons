// @ts-check
const { HtmlRspackPlugin } = require('@rspack/core');
const { createConfig } = require('./make-configs');

module.exports = createConfig({ name: 'rspack', HtmlPlugin: HtmlRspackPlugin });
