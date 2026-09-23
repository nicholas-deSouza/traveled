# Shared home globe with trip colors

## Home screen and real trip data

- [x] Make the authenticated home page show the shared globe instead of redirecting to Groups; update default sign-in destinations while preserving explicit return links.
- [x] Replace dummy trips, counts, and group links with real data from every group the user belongs to.
- [x] Show real trip cards below the globe, newest first, with title, dates, group name, photo count, and trip-color indicator.
- [x] Keep trips without located photos in the cards, even though they have no globe markers.
- [x] Load all accessible photo metadata through paginated queries, independently of gallery pagination, under existing RLS.
- [x] Add loading, error, retry, and empty states. When Supabase is unconfigured, show a setup state without dummy data.
- [x] Keep the globe exclusively on the home screen; trip pages retain their details, uploads, and gallery.

## Shared trip colors

- [x] Add a nullable `color` column to trips through a new migration, constrained to six-digit hex colors.
- [x] Use a deterministic trip-ID-based palette color until a custom color is saved, including for existing trips. Colors may repeat; uniqueness is not required.
- [x] Extend trip types and queries with `color` and `created_by`.
- [x] Add a labeled color-picker control on the trip page for the trip creator, with Save and Cancel actions and save-error feedback.
- [x] Save the chosen color for everyone. Preserve existing RLS: only the creator, while still a group member, can update the trip.
- [x] Apply the same effective color to globe dots, thumbnail borders, and trip-card indicators. Retain text labels so color is not the only identifier.

## Photo uploads and globe behavior

- [x] Extract GPS from original files during upload using the installed `exifr` library.
- [x] Save complete, finite, valid coordinate pairs—including zero—in existing photo columns.
- [x] Allow uploads without readable GPS; store null coordinates, label them “No location,” and keep them gallery-only.
- [x] Preserve existing formats, size limits, private Storage access, and failed-upload cleanup.
- [x] Refactor the globe to accept real trip/photo data. Start at world scale and preserve the camera during data refreshes.
- [x] Below zoom level 5, render trip-colored dots. At zoom level 5 and above, show approximately 64-pixel thumbnails with rounded trip-colored borders and count badges for groups larger than one.
- [x] Cluster photos separately for each trip using an 80-pixel radius. Never combine different trips into one thumbnail; identical coordinates within a trip stay grouped through maximum zoom.
- [x] Use stable representative photos. Offset overlapping markers from different trips deterministically, with small connector lines to preserve location meaning and access to each trip.
- [x] Make each thumbnail a keyboard-accessible link to its trip’s existing `/trips/:tripId` page, navigating in the same tab. Use the trip title and photo count in its accessible name.
- [x] Load only visible representative images through authenticated downloads, with bounded concurrency and caching; clean up obsolete markers and image URLs.
- [x] Provide unavailable-image and map-error states without blocking trip cards; retain map attribution.

## Deletion and refresh

- [x] Add confirmed, accessible delete controls for users’ own photos, including unavailable images.
- [x] Remove the Storage object before deleting its record; report partial failures and support retries when the file is already missing.
- [x] Refresh the gallery after uploads and deletions.
- [x] Reload home data when returning from a trip or refocusing the browser tab, reflecting uploads, deletions, color changes, and membership changes.
- [x] Recalculate counts and clusters, replace deleted representative images, and discard stale requests and cached private data on navigation or sign-out.

## Validation and agreed boundaries

- [ ] Test GPS extraction, missing metadata, pagination, trip isolation, color defaults, color persistence, and creator-only editing.
- [ ] Test clusters containing nearby photos from different trips, overlapping markers, matching border colors, and thumbnail navigation.
- [ ] Test upload cleanup, deletion retries, permissions, stale requests, and image cleanup.
- [ ] Verify desktop/mobile interaction, keyboard access, empty states, sign-in redirects, and return-to-home refresh.
- [ ] Extend and run the existing Node test harness, run relevant database permission checks, and run `pnpm lint` and `pnpm build`.
- [ ] Apply the new migration before deploying the UI that queries trip colors.

Existing-photo metadata backfill, manual location placement, capture-time extraction, and continuous live synchronization remain deferred. Older photos can be deleted and reuploaded.


## Implementation status

Application work and the migration file are implemented. Automated Node tests cover metadata extraction (including a generated JPEG with real EXIF), atlas pagination, color selection, coordinate aggregation, marker offsets, deletion failure/retry paths, auth destinations, and thumbnail lifecycle cleanup.

Database permission checks and desktop/mobile browser verification remain open: local PostgreSQL could not create shared memory, the fixture server could not bind a local socket, and headless Chrome could not launch in this environment. The migration has not been applied to a live Supabase project. Apply `0003_trip_colors.sql` before deploying this UI; run `supabase/tests/trip_colors.sql` in a disposable database to verify color permissions.
