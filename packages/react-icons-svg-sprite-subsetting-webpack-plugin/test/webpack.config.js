// @ts-check
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { createConfig } = require('./make-configs');

module.exports = createConfig({ name: 'webpack', HtmlPlugin: HtmlWebpackPlugin });
