import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../src/', import.meta.url));
function components(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'test' ? [] : components(path);
    return path.endsWith('.tsx') && !path.endsWith('.test.tsx') && path !== join(root, 'main.tsx') ? [path] : [];
  });
}
const missing = components(root).filter(path => !existsSync(path.replace(/\.tsx$/, '.test.tsx')));
if (missing.length) {
  console.error('Every component needs an adjacent .test.tsx file:\n' + missing.join('\n'));
  process.exitCode = 1;
}
