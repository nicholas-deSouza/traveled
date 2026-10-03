import { readFileSync, readdirSync } from 'node:fs';
import { createDiagnostics, fail, isMain, runScript } from './script-diagnostics.mjs';

// Fresh Supabase projects use a text storage.objects.owner_id. Preserve the
// historical migration on disk, but correct its legacy UUID comparison when
// assembling a fresh-install script. Existing projects apply 0002 directly.
export function freshSchema(migrationDirectory = new URL('../supabase/migrations/', import.meta.url), diagnostics = createDiagnostics('prepare-fresh-schema')) {
  diagnostics.event('assemble-schema', 'started');
  let names, contents;
  try {
    names = readdirSync(migrationDirectory).filter(name => name.endsWith('.sql')).sort();
    if (!names.includes('0001_initial_schema.sql')) throw fail('assemble-schema', 'missing_initial_migration', 'Fresh schema requires the initial migration.');
    contents = names.map(name => readFileSync(new URL(name, migrationDirectory), 'utf8'));
  } catch (error) {
    if (error?.name === 'ScriptError') throw error;
    throw fail('assemble-schema', 'file_read_failed', 'Could not read migration files. Check the migration directory and permissions.');
  }
  if (contents.some(sql => !sql.trim())) throw fail('assemble-schema', 'empty_migration', 'A migration file is empty. Restore it before assembling a fresh schema.');
  const initialIndex = names.indexOf('0001_initial_schema.sql');
  const initial = contents[initialIndex];
  const subsequent = contents.filter((_, index) => index !== initialIndex).join('\n');
  diagnostics.event('assemble-schema', 'completed', { count: names.length });
  return `begin;\n${initial.replaceAll('owner_id = auth.uid()', 'owner_id = auth.uid()::text')}\n${subsequent}\ncommit;\n`;
}

if (isMain(import.meta.url)) await runScript('prepare-fresh-schema', diagnostics => process.stdout.write(freshSchema(undefined, diagnostics)));
