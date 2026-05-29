import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

await build({
    entryPoints: [path.join(root, 'vendor/domd/domd-renderer-entry.jsx')],
    bundle: true,
    outfile: path.join(root, 'vendor/domd/domd-renderer.js'),
    format: 'iife',
    globalName: 'DOMDMarkdownBundle',
    minify: true,
    sourcemap: false,
    loader: { '.ts': 'ts', '.tsx': 'tsx' },
    alias: {
        '@do-md/utils': path.join(root, 'vendor/domd/utils/index.ts'),
        '@do-md/zenith': path.join(root, 'vendor/domd/zenith/index.ts'),
        '@do-md/zenith/middleware': path.join(root, 'vendor/domd/zenith/middleware/index.ts')
    }
});
