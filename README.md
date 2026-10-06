# Traveled

Shared travel memories, mapped from your photos.

Traveled is a group-based travel journal: friends create a group, manually create trips, upload their photos, and explore shared memories on an interactive globe and detailed map.

## Stack

- Vite, React, TypeScript
- Tailwind CSS and locally owned shadcn/ui-style components
- MapLibre GL JS globe projection
- Supabase Auth, Postgres, Storage, and Row Level Security

## Local setup

1. Install both the app and photo classifier dependencies (Node.js 24 or newer):

   ```sh
   pnpm install
   npm ci --prefix infrastructure/photo-classifier --include=optional
   ```

2. Create a project inside your Supabase organization. Open the project's **Connect** dialog for its Project URL and publishable key (also available under **Settings → API Keys**).
3. Create or update `.env` in the project root yourself:

   ```dotenv
   VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
   ```

   The historical `VITE_SUPABASE_ANON_KEY` variable is also supported and accepts a publishable key or legacy `anon` key. `VITE_SUPABASE_PUBLISHABLE_KEY` takes precedence when both are set. Never use a secret or `service_role` key in this browser application. See [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys).

4. For a **fresh database**, run `node scripts/prepare-fresh-schema.mjs > /tmp/traveled-schema.sql`, then paste the generated SQL into the Supabase SQL Editor and run it. It installs both migrations in a transaction, correcting the original migration's legacy Storage owner UUID comparison for modern text `owner_id` fields without changing the migration on disk. See [Storage ownership](https://supabase.com/docs/guides/storage/security/ownership).
   For a database that **already has migration 0001 applied**, run `supabase/migrations/0002_groups_and_invitations.sql`, then `supabase/migrations/0003_trip_colors.sql`. If 0002 is already applied, run only 0003.
5. In **Authentication → URL Configuration**, set the Site URL to your app origin (normally `http://localhost:5173` locally) and add `http://localhost:5173/**` to Redirect URLs. Substitute your actual Vite port if different. This permits the `/auth/callback?next=…` magic-link callback to restore an invitation after signing in. Configure the corresponding callback on your deployed origin as well. See [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).
6. Start or restart the app: `pnpm dev`. Open **Groups**, sign in by email, and create a group.

The app displays OpenFreeMap's detailed Liberty vector style when `VITE_MAP_STYLE_URL` is absent. It includes administrative boundaries and city labels as the user zooms in. Set that environment variable to your selected production vector-tile style before deploying.

## CI and automated review fixes

GitHub Actions runs lint and build checks. New PRs automatically receive the
`greploop` label so the Greptile → Codex loop can fix application-source findings
and push validated updates to eligible PR branches. Remove the label to opt out.
See [Greploop setup](docs/greploop.md) for GitHub credentials, activation, limits,
and troubleshooting. Final merging remains manual.

## MVP domain model

```text
User ↔ Group Membership
Group → Trips
Trip → Photos
```
