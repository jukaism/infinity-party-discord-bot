const esbuildPluginTsc = require('esbuild-plugin-tsc')
module.exports = () => ({
  external: [],
  plugins: [esbuildPluginTsc()],
  resolveExtensions: ['.ts', '.js', '.mjs'],
})
