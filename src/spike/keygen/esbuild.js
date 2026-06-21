const esbuild = require('esbuild');
const watch   = process.argv.includes('--watch');
const minify  = process.argv.includes('--minify');

esbuild.build({
    entryPoints: ['src/extension.ts'],
    bundle:      true,
    outfile:     'out/extension.js',
    external:    ['vscode'],
    format:      'cjs',
    platform:    'node',
    sourcemap:   true,
    minify,
    logLevel:    'info',
}).catch(() => process.exit(1));
