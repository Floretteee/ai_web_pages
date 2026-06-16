import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const pkgPath = join(rootDir, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

const [major, minor, patch] = pkg.version.split('.').map(Number);
const bumpType = process.argv[2] || 'patch';

if (bumpType === 'minor') {
  pkg.version = `${major}.${minor + 1}.0`;
} else if (bumpType === 'major') {
  pkg.version = `${major + 1}.0.0`;
} else {
  pkg.version = `${major}.${minor}.${patch + 1}`;
}

writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
console.log(`✓ Version bumped: ${pkg.version}`);
