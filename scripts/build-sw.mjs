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

const swContent = swTemplate
  .replace(
    /const CACHE_VERSION = ['"]__VERSION__['"];/,
    `const CACHE_VERSION = '${cacheVersion}';`
  )
  .replace(/__CACHE_BUST__/g, String(timestamp));

writeFileSync(join(rootDir, 'sw.js'), swContent, 'utf-8');

// Inject the same cache-bust token into index.html so the URLs requested by the
// page exactly match the URLs precached by the Service Worker. This keeps the
// single source of truth in the build step and removes manual ?v= maintenance.
const indexPath = join(rootDir, 'index.html');
let indexHtml = readFileSync(indexPath, 'utf-8');
const assetRefRe = /((?:src|href)=")((?:\.\/)?(?:css\/[^"?]*\.css|js\/[^"?]*\.js|presets\.js))(?:\?v=[^"]*)?(")/g;
let rewritten = 0;
indexHtml = indexHtml.replace(assetRefRe, (match, prefix, path, suffix) => {
  rewritten += 1;
  return `${prefix}${path}?v=${timestamp}${suffix}`;
});
writeFileSync(indexPath, indexHtml, 'utf-8');

console.log(`✓ Service Worker version: ${cacheVersion}`);
console.log(`✓ Cache bust token: ${timestamp}`);
console.log(`✓ index.html asset refs rewritten: ${rewritten}`);
