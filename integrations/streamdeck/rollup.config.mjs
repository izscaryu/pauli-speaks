// Bundles src/plugin.mjs, the Stream Deck SDK and lib/commands.js into one file that
// Stream Deck runs with its own Node.js. Run: npm run build
import commonjs from '@rollup/plugin-commonjs';
import nodeResolve from '@rollup/plugin-node-resolve';

const sdPlugin = 'com.pauli.speaks.streamdeck.sdPlugin';

export default {
  input: 'src/plugin.mjs',
  output: { file: `${sdPlugin}/bin/plugin.js`, format: 'es' },
  plugins: [
    nodeResolve({ browser: false, exportConditions: ['node'], preferBuiltins: true }),
    commonjs(),
    {
      name: 'emit-module-package-file',
      generateBundle() {
        this.emitFile({ fileName: 'package.json', source: '{ "type": "module" }', type: 'asset' });
      },
    },
  ],
};
