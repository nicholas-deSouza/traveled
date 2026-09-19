# UI plan implementation and remaining validation

Source: `/Users/nicholas/.codex/worktrees/0697/traveled/UI-PLAN.md`.
Implementation worktree: `/Users/nicholas/.codex/worktrees/7c8e/traveled`.

The plan is not fully verified. Code changes are present, but the required full
browser checks and live backend permission checks remain open. Lint and the full
application build now pass after dependencies were installed.

## Implemented

- `TripPhotos.tsx` opens images in a native dialog with a close button, Escape and
  backdrop dismissal; images are constrained to the viewport. `modal.tsx` manages
  explicit Tab/Shift+Tab focus wrapping, initial focus on Close/Cancel, and nested scroll locking.
- Gallery and viewer deletion controls are limited to the uploader. Gallery
  controls are separate from thumbnails and available for missing images.
- Confirmation provides Cancel and Delete, guards repeated submissions, displays
  errors, and refreshes the gallery and announces success after deletion. Deleting
  the sole photo on a later page goes back one page. Remaining images stay mounted during refresh; a gallery-scoped cache reuses their URLs and releases them on departure.
- `deletePhoto` re-reads metadata under RLS, verifies the authenticated uploader,
  removes Storage content before metadata, detects silently skipped file deletion,
  and reports partial failures with retry instructions. No policies were changed.
- `/` renders Explore unconditionally. Groups retains its protected route and
  existing sign-in destination handling. Sample cards no longer link to fake trips.
- Explore labels sample data and offers Pause/Resume rotation. Rotation observes
  elapsed time, pointer and keyboard interaction, visibility and reduced motion;
  animation and listeners are disposed on unmount.

## Verified

- `node --test scripts/test-trip-photos.mjs`: 17 passing checks. These use a mocked
  Supabase client and cover success, Storage failure, metadata failure, missing-file
  retries, uploader denial, zero deleted rows, skipped file deletion and failed
  existence checks, plus existing pagination/download/disposal behavior. Cache checks
  verify that only new or unavailable images download while metadata still revalidates under RLS.
- `node --test scripts/test-travel-globe.mjs`: 6 passing checks with a mocked map, including empty style URL fallback.
  They cover frame-rate independence, interaction and five-second delay, explicit
  pause, visibility/reduced-motion/movement suppression, and cleanup.
- `node --test scripts/test-photo-cache.mjs`: 5 passing lifecycle/race checks.
  They verify deletion keeps remaining images displayed, stale requests release only
  new URLs, unmount releases late downloads, refresh failures allow retry, and trip
  changes do not share cached images.
- Browser checks with the real signed-in test trip verified desktop and 390px mobile
  image containment, dark backdrop, image-click behavior, Escape and close dismissal,
  focus wrapping/restoration, confirmation cancellation, and nested scroll locking.
  Desktop backdrop dismissal was also verified. Repeated Tab initially escaped the
  native dialog; explicit wrapping fixed it and was retested in both viewports.
- Browser checks verified signed-out Explore, Groups redirect with `next=/groups`,
  return to Groups after user sign-in, signed-in Explore, active navigation on Explore
  and Groups, back/forward, actual rotation, paused stability, and resumed rotation.
- `git diff --check -- src scripts`: passed.

## Remaining required checks

- [x] Install locked dependencies and pass `pnpm lint` and `pnpm build`.
  The user installed dependencies. Lint passes. The regular build passed after dependency installation; subsequent
  builds encounter `EPERM` when clearing `dist/assets`, so the latest production
  build passed with `pnpm build --outDir /tmp/traveled-ui-focus-check`. Vite emits
  its existing large-bundle warning. All 28 automated checks pass.
- [x] Reproduce and fix the blank Explore map: the browser reported no style added.
  Empty/whitespace `VITE_MAP_STYLE_URL` values now use the default style. The running
  app was verified to render the globe and sample markers in the in-app browser.
- [ ] Finish rendered-app verification of duplicate-submit prevention, gallery
  refresh without reloading existing images, unavailable-photo cleanup, partial
  failure/retry, and deletion of the sole photo on the last pagination page.
  The current test trip contains one existing dog photo. Its deletion has not been
  authorized; a confirmation question offers retaining it and using generated test
  images instead. No live photo was deleted during these checks.
- [ ] Verify other members lack delete controls in the browser, and authenticated
  backend calls reject unauthorized deletion for both Storage and metadata.
  The available group has one member. Client mocks and migration inspection pass,
  but deployed enforcement has not been established. PostgreSQL 13.3 was found
  locally; initializing an isolated test database failed with shared-memory
  `Operation not permitted`, including the escalated retry.
- [ ] Finish browser checks for no Supabase configuration, actual reduced-motion
  preferences, interaction-delay timing and hidden-page behavior. Corresponding
  rotation logic has automated coverage, including equal speed at 5, 20, and 100 FPS.

Earlier browser verification attempts did not run: local Chrome launch failed,
the local HTTP server could not bind, and the in-app browser rejected the local
file URL. The rejected browser path was not bypassed. A temporary React 18 harness
with mocked data was prepared, but it did not run and is not validation evidence.

The running app is now accessible through the in-app browser at localhost:5173.
This enabled the globe rendering check above; the remaining browser checklist
items have not yet been fully verified.
