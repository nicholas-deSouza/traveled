import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

// Deliberately use this checkout's packages, never a parent's node_modules.
const root = resolve('infrastructure/photo-classifier');
try {
  const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path || entry.optional) continue;
    const installed = JSON.parse(readFileSync(resolve(root, path, 'package.json'), 'utf8'));
    if (installed.version !== entry.version) throw new Error('Outdated classifier dependency');
  }
  const require = createRequire(resolve(root, 'package.json'));
  require(resolve(root, 'node_modules/sharp'));
} catch {
  process.exitCode = 1;
}
