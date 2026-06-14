import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// 读取 package.json 获取版本号
const packageJson = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8'));
const version = packageJson.version;

// 读取 sw.js 模板
const swTemplate = readFileSync(join(rootDir, 'sw.js'), 'utf-8');

// 替换版本占位符
const swContent = swTemplate.replace(
  /const CACHE_VERSION = ['"]__VERSION__['"];/,
  `const CACHE_VERSION = 'fimall-chat-sw-v${version}';`
);

// 写回 sw.js
writeFileSync(join(rootDir, 'sw.js'), swContent, 'utf-8');

console.log(`✓ Service Worker version updated to: fimall-chat-sw-v${version}`);
