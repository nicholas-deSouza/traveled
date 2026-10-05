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

Every group member can view and contribute photos to that group’s trips. Photo files belong in the private `trip-photos` bucket under `<group-id>/<trip-id>/<filename>`. The database migration includes the RLS and Storage policies enforcing that boundary.

## Groups and access

### Password sign-in

- Signed-in users can select **Password** in the header to set or change their password. Passwords must contain at least 8 characters and satisfy any additional password rules configured in Supabase.
- New users start with a magic link to verify their email, then can set a password before continuing. Existing users can keep using magic links or use email and password at `/login`.
- **Set or reset password** on the login screen sends existing users a one-time recovery email. Its callback (`/auth/callback?intent=password&next=…`) opens the authenticated password form. The original group, trip, or invitation destination is preserved.
- Keep email authentication enabled and allow the callback URL, including its query parameters, in Supabase's Redirect URLs for each deployed origin. The local wildcard in setup step 5 already covers this flow. Recovery email templates should use Supabase's `{{ .ConfirmationURL }}` link. See [Supabase password authentication](https://supabase.com/docs/guides/auth/passwords).
- Verify with a test account: sign in by magic link, save a password, sign out, and sign in with that password. Then request a password reset and follow its email; verify mismatched passwords are rejected, a new password works, an expired link offers a retry, and an invitation still opens after setup.

The login, magic-link and recovery forms validate email syntax and reject emoji-containing identifiers before calling Auth, including when browser validation is bypassed. Passwords are passed unchanged to Auth: SQL-like text remains a credential value, never SQL source. Valid addresses such as `drop.table@example.com` are not rejected merely for containing SQL words.

Migration `20261004212122_account_security.sql` adds `auth_private.before_user_created(jsonb)` to enforce the email policy during new-account creation, including direct Auth API requests. Local Supabase enables this [Before User Created Auth hook](https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook) through `config.toml`. For hosted Supabase, apply the migration first, then select the function under Authentication → Hooks; verify signup immediately afterward. Existing login and email-change flows are outside this creation hook. Profile display names and password characters remain unrestricted by this policy. Confirm hosted email verification, password strength/leaked-password protection, CAPTCHA and rate limits in the project dashboard; local mocked tests cannot verify those settings or email delivery.

The same migration restricts profile reads to oneself and current shared-group peers, preserving roster names. Test both directions and removal of the last shared membership before deploying. It does not modify upload admission.

### Shared trips

- `/groups` lists only your groups and lets you create one. The creator automatically becomes its owner.
- `/groups/:groupId` lists that group's trips and members. All members can create trips.
- Owners can generate, replace, copy, and revoke a shared invitation link. Links expire after seven days, support multiple invitees, and grant the `member` role. Only a hash is stored in Postgres. Replacing or revoking a link invalidates previous links without removing existing members.
- `/join#token=…` requires authentication and an explicit **Join group** action. Reopening a valid invitation as a member is safe and does not duplicate membership.
- `/trips/:tripId` shows that trip's photos and supports multiple uploads. Still JPEG, PNG, WebP, and single-photo HEIC inputs are supported up to 20 MiB and 50 megapixels. Animated images, GIF and AVIF are rejected. Photos appear only after original and optimized-image verification; failed transfers support bounded retry and recovery.
- RLS restricts group, membership, trip, photo, and Storage reads to members. Trip creators may update/delete their own trips only while still members; uploaders may delete their own photos/files only while still members. Trip creators can choose a shared trip color; photo uploaders can delete their own photos. Member removal UI is not included yet.
- Storage paths must match both an existing group and its trip. Photo records must reference a file uploaded by the same user in that trip. Downloads use authenticated requests and temporary browser object URLs rather than public or reusable signed links. Already-downloaded data cannot be recalled from a former member's browser.
- Without Supabase configuration, the landing page shows setup instructions. Signed-in users open the shared home globe; inaccessible data is never replaced with demo trips.

## Validation

Run `pnpm lint` and `pnpm build` for application changes.

`supabase/tests/groups.sql` exercises invitations, membership isolation, trip creation, server-published gallery fixtures, denial of direct client publication, and revoked-member mutations. `supabase/tests/account_security.sql` tests profile privacy, roster joins, Auth-role hook privileges and signup validation under the function owner; it does not impersonate the reserved Auth role. Run these only in disposable databases. The database CI job assembles the full schema and runs these suites, trip-color/upload/queue assertions, and the localhost-only `scripts/check-account-security.mjs` and Storage API gates. The account HTTP gate proves actual hook invocation with its exact custom rejection and uses actual user tokens for enumeration and PostgREST embedded roster names; unrelated service errors cannot count as successful policy enforcement.

`supabase/tests/bootstrap.sql` supplies minimal Auth/Storage stand-ins for plain Postgres; do not run it in a Supabase project. The full upload schema also needs Supabase extensions, so use the CI disposable Supabase environment for full integration coverage. For a compatible disposable database named `traveled_test`:

```sh
node scripts/prepare-fresh-schema.mjs > /tmp/traveled-schema.sql
psql -d traveled_test -v ON_ERROR_STOP=1 -f supabase/tests/bootstrap.sql -f /tmp/traveled-schema.sql -f supabase/tests/groups.sql
```

The security tests roll back their fixtures. They verify PostgreSQL policies, not Supabase's HTTP Storage service or email delivery. For an end-to-end check on your configured project, create a group as user A, copy its invitation, open it in a separate browser profile as user B, join, create a trip, and upload a photo. Confirm A can see it and an uninvited user C cannot open either the group or trip. Generate a replacement invitation and verify the previous link fails.

GPS metadata is extracted before optimization and used on the globe. The pinned HEIC crop/padding/rotation/transparency corpus passes locally; packaged Linux and device/live release gates remain pending. See the release-results document.

## Component tests and pre-commit checks

Run both dependency installation commands from Local setup, then `pnpm test`
for the full local test suite: component/test pairing, Vitest component tests,
Node script tests, and photo classifier tests. The classifier's separate install
provides `sharp` and its optional native dependencies for generated image fixtures.
Use `pnpm test:watch` for
component watch mode or `pnpm test:unit -- src/components/ui/button.test.tsx` to
run one file. Tests use jsdom and React Testing Library, mock external services,
and do not load `.env` files or require Supabase credentials.

Every component file under `src/`, including pages and `App.tsx`, needs a sibling
`<name>.test.tsx` with meaningful behavior tests. `src/main.tsx` and `src/test/`
helpers are excluded. The pairing check prevents new components without test
files; assertions should cover the component's interactions and relevant states.

Enable the pre-commit hook in each clone with:

```sh
git config --local core.hooksPath .githooks
```

The hook reuses the classifier's working locked dependencies, installing them with
`npm ci --prefix infrastructure/photo-classifier --include=optional` only when
missing, outdated, or broken, then runs `pnpm test`. Installation or test failures block commits. It tests the current
working tree. Database policy tests above are separate integration tests requiring
a disposable PostgreSQL database.
## Shared home globe

Apply `supabase/migrations/0003_trip_colors.sql` to an existing project before deploying this UI. Fresh-install SQL generated by `scripts/prepare-fresh-schema.mjs` includes all migrations.

- Home shows trips from all your groups, real photo counts, and one shared globe. Dots use each trip's color; zooming in reveals thumbnails with matching borders. Photo groups never mix trips. Open a thumbnail to visit its trip.
- The trip creator can save a shared color from the trip page. Trips without custom colors use a stable palette color.
- New uploads extract GPS when available. Missing or invalid GPS does not block upload; these photos remain gallery-only. Existing photos are not backfilled: delete and reupload them to extract GPS.
- Photo deletion removes the file before its record. If only the file removal succeeds, retry deletion to remove the record. Home refreshes on navigation and tab focus; continuous live synchronization is not included.
- Globe thumbnails use authenticated downloads and bounded, temporary browser caches. A representative is downloaded only when visible at thumbnail zoom.

Run `node --test scripts/test-trip-photos.mjs scripts/test-atlas.mjs` for data and lifecycle tests. Add `-f supabase/tests/trip_colors.sql` to the disposable-database command above to verify shared color constraints and creator/member permissions.
