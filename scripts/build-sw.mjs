import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const packageJson = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8'));
const version = packageJson.version;
const timestamp = Date.now();

const swTemplate = readFileSync(join(rootDir, 'sw.template.js'), 'utf-8');

const swContent = swTemplate
  .replace(
    /const CACHE_VERSION = ['"]__VERSION__['"];/,
    `const CACHE_VERSION = 'fimall-chat-sw-v${version}';`
  )
  .replace(/__CACHE_BUST__/g, String(timestamp));

writeFileSync(join(rootDir, 'sw.js'), swContent, 'utf-8');

console.log(`✓ Service Worker version: fimall-chat-sw-v${version}`);
console.log(`✓ Cache bust token: ${timestamp}`);
