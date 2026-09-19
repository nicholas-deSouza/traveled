# Traveled

Shared travel memories, mapped from your photos.

Traveled is a group-based travel journal: friends create a group, manually create trips, upload their photos, and explore shared memories on an interactive globe and detailed map.

## Stack

- Vite, React, TypeScript
- Tailwind CSS and locally owned shadcn/ui-style components
- MapLibre GL JS globe projection
- Supabase Auth, Postgres, Storage, and Row Level Security

## Local setup

1. Install dependencies: `pnpm install`
2. Create a project inside your Supabase organization. Open the project's **Connect** dialog for its Project URL and publishable key (also available under **Settings → API Keys**).
3. Create or update `.env` in the project root yourself:

   ```dotenv
   VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
   ```

   The historical `VITE_SUPABASE_ANON_KEY` variable is also supported and accepts a publishable key or legacy `anon` key. `VITE_SUPABASE_PUBLISHABLE_KEY` takes precedence when both are set. Never use a secret or `service_role` key in this browser application. See [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys).
4. For a **fresh database**, run `node scripts/prepare-fresh-schema.mjs > /tmp/traveled-schema.sql`, then paste the generated SQL into the Supabase SQL Editor and run it. It installs both migrations in a transaction, correcting the original migration's legacy Storage owner UUID comparison for modern text `owner_id` fields without changing the migration on disk. See [Storage ownership](https://supabase.com/docs/guides/storage/security/ownership).
   For a database that **already has migration 0001 applied**, run only `supabase/migrations/0002_groups_and_invitations.sql`.
5. In **Authentication → URL Configuration**, set the Site URL to your app origin (normally `http://localhost:5173` locally) and add `http://localhost:5173/**` to Redirect URLs. Substitute your actual Vite port if different. This permits the `/auth/callback?next=…` magic-link callback to restore an invitation after signing in. Configure the corresponding callback on your deployed origin as well. See [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).
6. Start or restart the app: `pnpm dev`. Open **Groups**, sign in by email, and create a group.

The app displays OpenFreeMap's detailed Liberty vector style when `VITE_MAP_STYLE_URL` is absent. It includes administrative boundaries and city labels as the user zooms in. Set that environment variable to your selected production vector-tile style before deploying.

## MVP domain model

```text
User ↔ Group Membership
Group → Trips
Trip → Photos
```

Every group member can view and contribute photos to that group’s trips. Photo files belong in the private `trip-photos` bucket under `<group-id>/<trip-id>/<filename>`. The database migration includes the RLS and Storage policies enforcing that boundary.

## Groups and access

- `/groups` lists only your groups and lets you create one. The creator automatically becomes its owner.
- `/groups/:groupId` lists that group's trips and members. All members can create trips.
- Owners can generate, replace, copy, and revoke a shared invitation link. Links expire after seven days, support multiple invitees, and grant the `member` role. Only a hash is stored in Postgres. Replacing or revoking a link invalidates previous links without removing existing members.
- `/join#token=…` requires authentication and an explicit **Join group** action. Reopening a valid invitation as a member is safe and does not duplicate membership.
- `/trips/:tripId` shows that trip's photos and supports multiple uploads. JPEG, PNG, WebP, and GIF files are accepted up to 20 MB each. An upload failure reports partial progress; select only remaining files to retry.
- RLS restricts group, membership, trip, photo, and Storage reads to members. Trip creators may update/delete their own trips only while still members; uploaders may delete their own photos/files only while still members. Editing/deletion controls and member removal UI are not included yet.
- Storage paths must match both an existing group and its trip. Photo records must reference a file uploaded by the same user in that trip. Downloads use authenticated requests and temporary browser object URLs rather than public or reusable signed links. Already-downloaded data cannot be recalled from a former member's browser.
- Without Supabase configuration, the landing page remains a labeled sample preview. Configured sessions open real groups; demo trips are never substituted for inaccessible data.

## Validation

Run `pnpm lint` and `pnpm build` for application changes.

`supabase/tests/groups.sql` exercises invitations, membership isolation, trip creation, photo registration, Storage path validation, and revoked-member mutations. Run it only in a disposable local PostgreSQL database. `supabase/tests/bootstrap.sql` supplies minimal Auth/Storage stand-ins for plain Postgres; do not run that bootstrap in a Supabase project. For example, after creating an empty local database named `traveled_test`:

```sh
node scripts/prepare-fresh-schema.mjs > /tmp/traveled-schema.sql
psql -d traveled_test -v ON_ERROR_STOP=1 -f supabase/tests/bootstrap.sql -f /tmp/traveled-schema.sql -f supabase/tests/groups.sql
```

The security tests roll back their fixtures. They verify PostgreSQL policies, not Supabase's HTTP Storage service or email delivery. For an end-to-end check on your configured project, create a group as user A, copy its invitation, open it in a separate browser profile as user B, join, create a trip, and upload a photo. Confirm A can see it and an uninvited user C cannot open either the group or trip. Generate a replacement invitation and verify the previous link fails.

EXIF extraction and mapping real uploaded photos remain future work.
