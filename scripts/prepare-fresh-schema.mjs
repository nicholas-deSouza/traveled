import { readFileSync, readdirSync } from 'node:fs';

// Fresh Supabase projects use a text storage.objects.owner_id. Preserve the
// historical migration on disk, but correct its legacy UUID comparison when
// assembling a fresh-install script. Existing projects apply 0002 directly.
const initial = readFileSync(new URL('../supabase/migrations/0001_initial_schema.sql', import.meta.url), 'utf8');
const migrationDirectory = new URL('../supabase/migrations/', import.meta.url);
const subsequent = readdirSync(migrationDirectory).filter(name => name.endsWith('.sql') && name !== '0001_initial_schema.sql').sort().map(name => readFileSync(new URL(name, migrationDirectory), 'utf8')).join('\n');
process.stdout.write(`begin;\n${initial.replaceAll('owner_id = auth.uid()', 'owner_id = auth.uid()::text')}\n${subsequent}\ncommit;\n`);
