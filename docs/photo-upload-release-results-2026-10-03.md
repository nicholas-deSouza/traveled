# Photo upload validation record — 2026-10-03

Release acceptance: **PENDING**. This record separates observed results from automated coverage and prerequisites that are unavailable.

Base checkout: `8336143` (plus this validation change). The running localhost frontend's main checkout is `027ce21`; the fixes in this worktree are not installed in that running frontend. Backend screenshot supplied by operator: successful `deploy-photo-upload.yml` on `main`, commit `027ce21`, duration 4m 23s; its deployment-time summary says admission remains paused. Later trusted SQL snapshots confirmed admission was enabled during testing; no pre-test health baseline was captured. Direct GitHub CLI read failed DNS resolution; the connector's commit-run wrapper only lists PR-triggered runs and did not identify the manual deployment.

## Executed local checks

| Check | Result | Evidence/limit |
| --- | --- | --- |
| Dependency graph | PASS via matching installed checkout | Before adding the browser-check script, root package.json and pnpm-lock.yaml hashes matched main; installed dependencies copied locally after registry DNS failures. Lockfiles unchanged |
| `pnpm test` | PASS | GPS-fix suite: 163 Vitest tests, 76 Node script tests, 20 classifier tests (259 total) |
| `pnpm lint` | PASS | Zero warnings/errors after implementation |
| `pnpm build` | Output cleanup BLOCKED; fresh-output build PASS | Initial build passed. Subsequent normal/escalated builds cannot clear existing dist (EPERM). `pnpm build --outDir /private/tmp/traveled-release-build-1cveEU` passed with actual worker/libheif assets; existing large-chunk warning remains |
| Vite worker import regression | PASS | Actual module worker, pinned HEIC bundle and browser smoke runner pass Vite import analysis without .env or a listening port |
| Browser harness TypeScript check | PASS | Explicit tsc check of the script plus vendor declarations; both Node scripts also pass syntax checking |
| DOM lint rule regression suite | PASS | 27 tests |
| Classifier locked install | PASS | `npm ci --offline --prefix infrastructure/photo-classifier --include=optional --ignore-scripts` |
| Classifier build/native smoke | PASS for tested fixtures | macOS Node 25.5.0; generated JPEG/PNG/WebP, oversized-source conversion, libheif WASM initialization, and later public still/alpha HEIC fixtures; not Linux artifact validation |
| Isolated browser smoke | BLOCKED | Local server bind returns EPERM at 127.0.0.1:5181, including escalated attempt. Command and harness prepared for an operator-run browser check |
| Docker/Supabase SQL/real Storage | BLOCKED locally | Docker and Supabase CLI unavailable. Retain successful GitHub gates for the release revision |
| Linux Node24 packaged HEIC corpus | NOT RUN here | Linux artifact environment and reviewed real still/orientation/auxiliary corpus unavailable |

The nine new processing-worker tests cover WebP output/size, orientation request and scaling, pixel limits, single-photo HEIC decoding, multi-photo count mismatches, decode failure, and native image/context cleanup. New source-validation/manager tests reject unsupported bytes before admission and preserve the valid portion of a mixed selection. Existing tests cover moderation thresholds/errors/quotas, retry limits, recovery, stale identities, publication races, capacity, ownership, and cleanup; coverage alone is not release acceptance.

## Live test window

Use account alias A for the operator-supplied disposable account; credentials and email are excluded from this record. User completed sign-in personally in Codex's localhost browser. Created:

- Group: **Upload release checks 2026-10-03**, ID `2af7c724-7ab2-48aa-8782-95dc62c5de90`.
- Trip: **Synthetic photo upload checks**, ID `28a013ad-23ec-458e-bcc8-f77672fefcb7`.
- Fixtures: generated 640×480 JPEG/PNG/WebP, empty JPEG, and unsupported text; no private image data/GPS. Four successful publications remain in the test trip (JPEG, PNG, WebP, and a separate JPEG recovery submission).

| Cases | Result | Observation |
| --- | --- | --- |
| Test-account authentication/group/trip setup | PASS | Browser showed signed-in controls, empty groups, then created dedicated group and trip |
| H01/M01 live JPEG and deployed provider | PASS for end-to-end upload | Real gallery image visible and queue says Added to gallery. Code's original/candidate moderation gates were exercised; account plan/usage counters not inspected |
| H02 live PNG/WebP | PASS | Both appeared alongside the JPEG; mixed selection did not discard valid files |
| H06/I01 mixed selection | Defect reproduced; local fix VERIFIED; live rerun PENDING | Empty JPEG rejected immediately. Unsupported text was admitted and retried before a visible technical failure. Worktree now rejects unsupported bytes before admission; passing regression tests verify no invalid admission/transfer. Running main still needs this change and rerun |
| C01 cancellation of failed test submission | PASS for this case | Canceled unsupported-file submission; queue settled with zero awaiting completion |
| R01 refresh/recovery | PASS for one observed path only | An immediate reload before durable queueing reset selection and created no gallery item. A separate durable upload showed Transferring original before reload, Awaiting final verification after reload, and then Added to gallery. Final count increased from three to four; all other interruption stages remain untested |
| Other live image/recovery/cancellation cases | NOT RUN | Follow the ordered checklist; do not infer broader race/format coverage from these checks |
| Accounts B/C and live access isolation | NOT RUN | Additional accounts not provided; isolated coverage remains available |
| Actual provider allowance exhaustion | NOT RUN | No quota exhaustion intentionally induced |
| Phone/tablet/Firefox/Safari checks | NOT RUN | Requires representative devices and browser runs |
| Admission baseline/window closure | UNVERIFIED | No trusted SQL Editor connection; operator must run health/pause queries in the checklist |

## Follow-up testing — 2026-10-03

The user requested continuation across seven remaining areas. The running frontend was confirmed by its listening process's working directory to be `/Users/nicholas/Documents/ChatGPT/traveled`, not this worktree. Live results below therefore exercise that existing frontend, not the local fixes. No production configuration, credentials, plan, membership, or RLS policies were changed.

| Requested area | Executed result | Still required |
| --- | --- | --- |
| 1. HEIC, orientation, GPS, malformed/animated | Live still HEIC and alpha-auxiliary HEIC published; JPEG EXIF orientation 6 visually correct with decoded gallery dimensions 160×320 from a 320×160 source. Artificial GPS 0,0 and two approved camera JPEGs published, with saved GPS verified in SQL without exposing coordinates. Camera A has EXIF orientation 3 and its gallery image visually matches the supplied reference. Damaged JPEG/PNG/WebP/HEIC and actual two-frame animated WebP all reached unsupported-image terminal outcomes without publication. Local fixture tests verify GPS bytes, rotation tag, two-frame WebP/GIF, and decoder rejection of malformed files, renamed text, GIF, and AVIF | iPhone/camera HEIC; rotated/mirrored HEIC; thumbnails/depth/multiple-top-level corpus; other EXIF orientations; live GIF/AVIF/APNG and renamed-file rejection after frontend fix |
| 2. Interruption/cancellation stage matrix | A live refresh after observing original verification/processing resumed both valid fixtures to publication. Sixteen new isolated manager tests pass: cancellation in all seven unfinished phases, restart/offline/reconnect in all seven phases, a late processing result after cancel, and stopped-account resource cleanup/filtering | Exact live interruption/cancel at every stage, tab-close recovery, live offline transfer recovery and reselection. Two timing attempts advanced before the target stage/action; neither is counted as a close/cancel pass |
| 3. Multiple tabs, retries, account switching | One JPEG submitted from a second tab published once and appeared in both tabs; gallery increased from four to five. Another PNG completed once with both tabs open. Isolated account filtering passes. Four additional tests cover mid-transfer offline recovery and repeated manual retry cycles for original/candidate transfers, bounded retries and no overlap when a held transfer ignores abort | Live repeated manual retries, simultaneous competing work/retry races, and sign-out/sign-in with a different account |
| 4. Separate-account/actual Storage access | No new live pass; no second account or disposable Storage backend available | Member/non-member accounts, actual owner-only quarantine/immutable writes/withheld gallery API gates |
| 5. Physical cleanup, reservations, health | Trusted SQL final snapshot: no unfinished/failed jobs, expired leases, pending cleanup or outstanding reservations; Cron/pg_net/queues/scheduling healthy. Test-trip original/candidate objects marked removed and absent from Storage catalog; 12 publication objects remain. Admission enabled | Physical Storage API GET/deletion checks, cross-account permissions, pre-test baseline and approved window closure |
| 6. Sightengine usage and suitability | Dashboard verified Free Trial/Free Tier, 2,000 operations/month and 500/day. Two approved camera JPEGs, including ordinary beach/swimwear, passed both gates. Usage increased 27→31 operations, consistent with four successful requests. Latest swimwear candidate returned all three required blocking scores at 0.001 | Broader representative moderation corpus, model/request-parameter audit and actual quota behavior through an approved facility or natural exhaustion |
| 7. Linux HEIC artifact | Real still/alpha HEIC native/WASM smoke passes on macOS Node25 | Linux x86_64 Node24 packaged artifact and reviewed orientation/auxiliary corpus; no Docker/Podman/Colima/Lima/AWS/SAM/Supabase tooling available |

Public non-personal HEIC fixtures came from the upstream libheif corpus through the GitHub connector (no binary fixture committed to this repo):

- [rainbow-451x461.heic](https://github.com/strukturag/libheif/blob/master/tests/data/rainbow-451x461.heic), Git blob `6691f50f39bd69871a2abe284de2ef9f5243bc66`, 7,080 bytes; local decoder and live gallery 451×461.
- [with-alpha-512x512.heic](https://github.com/strukturag/libheif/blob/master/tests/data/with-alpha-512x512.heic), Git blob `897d470339a3f4ceeff5155e981bbefceea9f648`, 8,284 bytes; local decoder and live gallery 512×512. This is an alpha auxiliary example, not a depth/thumbnail example. Browser and classifier rendering can treat transparency differently; no claim of an alpha compositing golden-image match is made.
- [clap_cropped.heic](https://github.com/strukturag/libheif/blob/master/tests/data/clap_cropped.heic), Git blob `af1852bb082591efa0fdd858839ebd88ed38940f`; local pinned WASM decoder returned a security-limit/decode error and the pipeline rejected it as `Damaged HEIC`. Independent subagent reproduced this with native and WASM libheif 1.23.2; valid 256×256 coded image with a 64×64 clean-aperture crop. Evidence matches upstream [issue 1856](https://github.com/strukturag/libheif/issues/1856) and its [memory-limit fix](https://github.com/strukturag/libheif/commit/95670f0316f75cd8ecd1777a35c1251286a09298), present in v1.23.3 source. **Known decoder compatibility regression; not a damaged-file finding.** It was not uploaded live. No dependency upgrade or security-limit bypass was implemented; a corrected pinned build and crop regression test remain required.
- Upstream `examples/example.heic`, Git blob `829384037820e545467a4af49aa6414c2b0f2885`, 718,114 bytes, was rejected by container sequence-brand checks before decoding. It is not used as a passing still fixture and was not uploaded live.

The new synthetic fixture generator produces asymmetric rotation and artificial-GPS photos plus malformed/unsupported/two-frame fixtures without private photos. `scripts/test-upload-fixtures.mjs` verifies their properties and server-side rejection. Temporary fixtures and helper files were retained, not deleted.

Environment checks were retried: the isolated browser checker still fails to bind localhost:5181 even with escalation; the macOS `sips` HEIC encoder failed through restricted system services even with escalation. GitHub connector retrieval provided the safe HEIC alternative. Neither blocked action is recorded as successful. Changelog Markdown retrieval was unavailable (web content-type error, shell DNS failure); no Supabase implementation/schema changes were attempted.

Final follow-up verification:

- `pnpm test`: PASS, 239 tests (143 + 76 + 20), including subagent's four additional retry-flow tests. Targeted manager suite: 48 tests passed.
- `pnpm lint`: PASS, zero warnings/errors.
- `pnpm build --outDir /private/tmp/traveled-release-round2-KVQnOh`: PASS in a fresh directory; subagent also verified final source with fresh output `/private/tmp/traveled-retry-flow-build-20261003-1547`. Existing large-chunk warning.
- `node infrastructure/photo-classifier/test/artifact-smoke.mjs '' HEIC_FIXTURE`: PASS separately for the still and alpha examples on macOS, **not** the Linux artifact gate.
- `git diff --check`: PASS.

Twelve published test photos now remain in the trip, with eight on page 1 and pagination for the rest; only the two valid JPEGs were published from the seven-file malformed/animated batch. Five invalid submissions did not increase gallery count. Two subsequent HEIC publications increased the total from eight to ten; the approved camera JPEGs increased it to twelve. Both camera gallery images decode at 2560×1920. Queue shows zero awaiting completion. Screenshots `photo_upload_formats_round2.jpg` and `photo_upload_approved_camera_results.jpg` show HEIC/orientation fixtures and the two approved photos with a settled queue. The walkthrough-artifacts skill's recording facility is unavailable in this session; screenshot evidence is provided instead.

User approved both original camera JPEGs, including GPS metadata, for Supabase and Sightengine. File signatures confirm these are JPEGs, not phone-original HEIC files. Private filenames, coordinates, image bytes and full provider bodies are excluded from this record. Both submissions are published with original/candidate approval, GPS acknowledgement, valid non-null gallery GPS and no pending cleanup. Artificial 0,0 GPS was retained separately.

Final `upload_health()` snapshot after all publications: `cron`, `pg_net`, `queues`, `scheduled` true; `unfinished`, `failed_jobs`, `quota_paused`, `expired_leases`, `cleanup_pending`, `oldest_ready_job_seconds`, and `outstanding_reservation_bytes` zero; `storage_bytes` 5,220,200; `admission_enabled` true. This is a point-in-time check, not sustained monitoring. The SQL Editor initially replaced only its visible text segment, producing a syntax error; selecting the entire query corrected it and the read-only check succeeded. No database changes were made.

Test-trip object aggregate: originals 18/18 marked removed, candidates 23/23 marked removed, both absent from `storage.objects`, reservation bytes zero for those stages. Publication objects: 23 tracked, 11 marked removed, 12 present in Storage catalog, 543,610 retained publication reservation bytes. Do not confuse that retained accounting column with outstanding reservations: health reports zero outstanding reservations. Catalog absence alone is not physical-file deletion proof.

Subagents were used for the new retry flows and independent HEIC compatibility triage, as requested. Their findings were reviewed; only the retry test file was changed by a subagent. Pending user handoffs: actual phone-original HEIC files (prefer ZIP), a second disposable account with credentials entered personally, a Linux/container environment, and live verification of the worktree fixes. Admission was not toggled by the agent. General release acceptance remains **PENDING**.

## Phone-original HEIC follow-up

The user supplied and explicitly approved a genuine camera HEIC, including embedded GPS, for Supabase/Sightengine testing. Referred to here as camera C; private filename/path, coordinates and image bytes are excluded. Container major brand `heic`, file size 3,099,573 bytes, exactly one top-level photo. Embedded TIFF inspection confirms GPS and a 90° clockwise orientation tag; source EXIF dimensions 5712×4284.

Independent subagent ran the existing classifier artifact-smoke script successfully on macOS Node25.5.0 x64, Sharp0.35.5/libheif-js1.23.2. Decoded pixels 4284×5712, prepared JPEG 1920×2560 and 1,132,575 bytes; prepared image contains no EXIF/XMP/orientation tag. This is a local source check, not the packaged Linux gate.

Live upload: preview initially unavailable, but upload succeeded through both moderation gates and gallery publication. Actual gallery image is portrait 1920×2560. No supplied reference/golden image was available for an independent exact orientation/compositing comparison. The trip now contains 13 published photos; queue reports zero awaiting completion. Screenshot `photo_upload_phone_heic_published.jpg` shows the new gallery image and settled queue. Running frontend still belongs to the existing main checkout, not these worktree fixes.

**GPS preservation FAILED for this HEIC.** Trusted SQL confirms `published`, original/candidate approvals true, GPS acknowledgement true, no pending cleanup, but gallery GPS absent. Local pinned exifr7.1.3 reproduces `Unknown file format` on the whole container, while parsing its embedded TIFF confirms valid GPS. Its [HEIF detector](https://raw.githubusercontent.com/MikeKovarik/exifr/v7.1.3/src/file-parsers/heif.mjs) rejects `ftyp` lengths above 50 bytes; this valid file has a 52-byte `ftyp` box. `extractLocation` catches the failure and returns null coordinates, so GPS acknowledgement does not imply coordinates were preserved. No metadata-reader fix, package change or manual coordinate backfill was implemented during this test.

Post-HEIC health snapshot: Cron/pg_net/queues/scheduling true; unfinished jobs, failed jobs, pending cleanup, expired leases, quota pauses and outstanding reservations all zero; `storage_bytes` 5,645,982, admission enabled. This does not verify physical deletion or sustained service health. Phone-original HEIC coverage is now partial rather than unavailable; metadata compatibility is a new unresolved release finding. Prior cropped-HEIC regression and Linux/cross-account/interruption gaps remain.

## HEIC GPS compatibility fix — local verification

At the user's request, `src/lib/photoMetadata.ts` now retries a failed metadata read for bounded, structurally supported HEIC containers with large `ftyp` boxes. It creates a metadata-only byte copy: a 24-byte compatible `ftyp` plus a same-size `free` box occupy the old header region, leaving all subsequent bytes/absolute item offsets unchanged. Original upload, fingerprint, image processing, moderation and Storage/API contracts are unchanged. No dependency versions, schema, credentials, RLS, admission, stored photos or GPS values were changed.

Fallback guards include a maximum 4,096-byte brand list and existing 20 MiB source cap, ordinary aligned box sizes, complete headers, HEIC brand recognition and rejection of sequence/AVIF brands. A complete, forward-progressing ordinary top-level box chain must lead to `meta` before invoking the fallback parser; zero-size/extended-size/non-progressing chains are not adapted. This narrow compatibility fix does not claim support for every HEIF `iloc` layout or repair the separate cropped-image decoder regression. Missing/damaged metadata still returns null without blocking uploads; normal supported files retain the original reader path.

Twenty new synthetic tests exercise the actual installed reader: 48-byte browser control, 52/64/4096-byte headers, distant EXIF, byte/size/offset invariants, source immutability, both TIFF byte orders, south/west and zero coordinates, absent/damaged EXIF, malformed sizes/brands, non-progressing boxes, and ordinary JPEG behavior. Fixtures contain only artificial GPS and no private photo data. The older atlas VM test harness now loads the unchanged shared upload limits dependency. Subagent review found a browser test-fixture Blob mismatch; it was corrected so the browser FileReader path demonstrably fails with the actual `Unknown file format` detector error before succeeding through the adapter. No production correctness finding remained in that review.

Local verification against camera C's original reported only booleans: valid GPS recovered, exact match to its embedded TIFF GPS, and source unchanged, all true. The bundled TypeScript module executed locally with no network/upload and without printing coordinates. No private fixture was committed.

Verification: `pnpm test` 259 passes (163 + 76 + 20), `pnpm lint` passes, `pnpm build --outDir /private/tmp/traveled-heic-gps-fix-20261003-1612` passes (existing large-chunk warning), scoped `git diff --check` passes. Live end-to-end rerun remains pending: localhost still runs the separate main checkout, not this worktree. Existing published camera C has no saved GPS and was not backfilled. Prior screenshots show the pre-fix upload, not proof of this metadata fix. No new live walkthrough/recording was possible under that checkout/environment limitation.

## Acceptance status

Final local validation passed as above. The unsupported-source fix and HEIC top-level/context changes are reviewable in this worktree; they are not deployed. No schema, API wire contract, or RLS changes were made.

Initial live screenshot `photo-upload-live-check.jpg` shows the first four generated images. Later screenshots and trusted SQL results above supersede the initial unverified health/cleanup/provider status.

Admission remains enabled in the final trusted snapshot; it was not paused by the agent. Window closure requires an explicit operator decision. Retain the published photos, group and trip for inspection. The unsupported pending submission was explicitly canceled, invoking the existing cleanup workflow; no published photos, groups, trips, or local files were deleted. Do not treat the current enabled state or these partial passes as general release approval while required checks remain unresolved.
