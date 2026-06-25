import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const packageJson = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8'));
const version = packageJson.version;
const timestamp = Date.now();
const cacheVersion = `fimall-chat-sw-v${version}-${timestamp}`;

const swTemplate = readFileSync(join(rootDir, 'sw.template.js'), 'utf-8');

const swContent = swTemplate.replace(
  /const CACHE_VERSION = ['"]__VERSION__['"];/,
  `const CACHE_VERSION = '${cacheVersion}';`
);

writeFileSync(join(rootDir, 'sw.js'), swContent, 'utf-8');

// Cache busting is handled entirely by the per-deploy CACHE_VERSION (old cache
// buckets are dropped in the SW activate handler), so strip any leftover ?v=
// query tokens from index.html asset refs to keep URLs clean and stable.
const indexPath = join(rootDir, 'index.html');
let indexHtml = readFileSync(indexPath, 'utf-8');
const assetRefRe = /((?:src|href)=")((?:\.\/)?(?:css\/[^"?]*\.css|js\/[^"?]*\.js|presets\.js))\?v=[^"]*(")/g;
let stripped = 0;
indexHtml = indexHtml.replace(assetRefRe, (match, prefix, path, suffix) => {
  stripped += 1;
  return `${prefix}${path}${suffix}`;
});
writeFileSync(indexPath, indexHtml, 'utf-8');

console.log(`✓ Service Worker version: ${cacheVersion}`);
console.log(`✓ index.html ?v= tokens stripped: ${stripped}`);
