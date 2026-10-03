import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDiagnostics, fail, isMain, runScript } from './script-diagnostics.mjs';

const root = fileURLToPath(new URL('../src/', import.meta.url));
function components(directory, root) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'test' ? [] : components(path, root);
    return path.endsWith('.tsx') && !path.endsWith('.test.tsx') && path !== join(root, 'main.tsx') ? [path] : [];
  });
}
export function checkComponentTests(directory = root, diagnostics = createDiagnostics('check-component-tests')) {
  diagnostics.event('component-pairs', 'started');
  let files;
  try { files = components(directory, directory); }
  catch { throw fail('component-pairs', 'file_read_failed', 'Could not enumerate component files. Check the source directory and permissions.'); }
  const missing = files.filter(path => !existsSync(path.replace(/\.tsx$/, '.test.tsx')));
  if (missing.length) throw fail('component-pairs', 'missing_component_tests', 'Every component needs an adjacent .test.tsx file:\n' + missing.join('\n'), { count: missing.length });
  diagnostics.event('component-pairs', 'completed', { count: files.length });
  return files.length;
}

if (isMain(import.meta.url)) await runScript('check-component-tests', diagnostics => checkComponentTests(root, diagnostics));
