import { readFileSync } from 'node:fs';

// Fresh Supabase projects use a text storage.objects.owner_id. Preserve the
// historical migration on disk, but correct its legacy UUID comparison when
// assembling a fresh-install script. Existing projects apply 0002 directly.
const initial = readFileSync(new URL('../supabase/migrations/0001_initial_schema.sql', import.meta.url), 'utf8');
const groups = readFileSync(new URL('../supabase/migrations/0002_groups_and_invitations.sql', import.meta.url), 'utf8');
process.stdout.write(`begin;\n${initial.replaceAll('owner_id = auth.uid()', 'owner_id = auth.uid()::text')}\n${groups}\ncommit;\n`);
