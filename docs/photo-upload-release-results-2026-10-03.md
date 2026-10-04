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

### Requested updated-main live rerun — blocked prerequisite

The requested rerun was attempted on 2026-10-03. Listening Vite process PID 7375 on localhost:5173 had working directory `/Users/nicholas/Documents/ChatGPT/traveled`. That checkout's `main` was still `027ce21`, and its metadata reader lacked the HEIC compatibility fallback. Locally available `origin/main` and this validation worktree were `def6e06c7e555d9307645eb23ed4a459cccbdddf`, which includes the fallback. Thus the running frontend could not be confirmed as updated.

An escalated `git merge --ff-only origin/main` in the main checkout failed before updating HEAD: macOS denied creation of `.git/ORIG_HEAD.lock` (`Operation not permitted`). Terminal computer control was also disallowed. The unrelated `skills-lock.json` change was preserved. The operator was asked to fast-forward that checkout and restart `pnpm dev`.

The existing Arc Supabase SQL Editor tab was signed in, but subsequent computer control returned `noWindowsAvailable`. No SQL was executed, no admission settings were changed, and no new health result was obtained. Camera C was not re-uploaded. Original verification, GPS, processing, candidate verification, publication, final submission checks, and the requested published-photo/settled-queue screenshot are **NOT RUN** for this rerun. Release acceptance remains **PENDING**.

After the updated frontend is confirmed and camera C is uploaded, run this read-only metadata-safe query in SQL Editor. It selects the newest submission in the existing test trip and omits filenames, coordinates, hashes, object paths, credentials, and provider bodies. Correlate the returned ID/time with this upload before counting it as a pass:

```sql
with newest as (
  select id, created_at, outcome, original_approved, candidate_approved,
         gps_acknowledged, cleanup_pending
  from upload_private.submissions
  where trip_id = '28a013ad-23ec-458e-bcc8-f77672fefcb7'::uuid
  order by created_at desc, id desc
  limit 1
)
select s.id, s.created_at, s.outcome, s.original_approved,
       s.candidate_approved, s.gps_acknowledged, s.cleanup_pending,
       (p.id is not null and p.latitude is not null
        and p.longitude is not null) as gallery_gps_present
from newest s
left join public.photos p on p.id = s.id;

select public.upload_health();
```

Required result: `published`, both approvals true, GPS acknowledgement true, gallery GPS present true, cleanup pending false; health failed jobs, pending cleanup, and outstanding reservations zero. These remain expected values, not observed results.

### Updated-main live rerun — executed, GPS preservation FAIL

The operator pulled the changes and restarted the frontend. Subsequent checks confirmed branch `main` at `def6e06`, with `legacyHeicGpsInput` present in its metadata reader. New listening Vite PID 32581 served localhost:5173 from `/Users/nicholas/Documents/ChatGPT/traveled`. The existing signed-in test trip was opened in Codex's browser. Camera C's original HEIC was selected from the operator-requested path (3,099,573 bytes) and uploaded once.

Baseline SQL Editor health: Cron, pg_net, queues and scheduling true; unfinished, failed jobs, quota pauses, expired leases, pending cleanup and outstanding reservation bytes zero; storage bytes 5,645,982; admission enabled. No admission settings were changed.

Submission `e8142094-8875-431f-abbf-a7605a29e2fe`, created `2026-10-03 23:30:19.695571+00` (16:30:19 PDT), was identified as the newest test-trip submission while original verification was underway. A subsequent ID-scoped read-only SQL Editor query returned:

| Gate | Observed result |
| --- | --- |
| Original verification | PASS: `original_approved = true` |
| GPS protocol stage | PASS: `gps_acknowledged = true` |
| GPS preservation | **FAIL: `gallery_gps_present = false`** |
| Image processing | PASS for completion: resulting image visible in gallery; intermediate processing phase not individually captured |
| Candidate verification | PASS: `candidate_approved = true` |
| Publication | PASS: `outcome = 'published'`; newest gallery tile shows camera C's scene |
| Cleanup | PASS for tracked state: `cleanup_pending = false` |

Original transfer and awaiting original verification were observed in the UI. Later stages completed between observations; approval/GPS/publication checks above are final persisted evidence, not individual screenshots of every intermediate stage. Metadata-safe SQL omitted coordinates, filenames, object paths, hashes, credentials and provider bodies. The GPS compatibility fix therefore does **not** pass live acceptance despite successful publication. Cause remains undiagnosed; no backfill or additional code/schema changes were made.

Final `public.upload_health()` in SQL Editor: Cron, pg_net, queues and scheduling true; unfinished, failed jobs, quota pauses, expired leases, pending cleanup and outstanding reservation bytes all zero; storage bytes 6,071,764; admission enabled. The frontend queue showed zero awaiting completion. Old unsupported-fixture outcomes remain visible and do not represent unfinished work.

Screenshot: `/private/tmp/traveled-heic-gps-published-20261003.jpg` shows the newly published HEIC as the first tile and the settled queue. Private screenshot pixels are retained locally and were not committed to the repository. Release acceptance remains **PENDING**, with the requested non-null gallery GPS gate **FAILED**.

### Fresh-tab HEIC GPS retry — PASS

At the user's request, camera C was uploaded again after the older localhost tabs were no longer present in Arc's observed tab list. Codex's prior frontend tab was also absent; a fresh signed-in localhost tab was opened. Main remained `def6e06` with the compatibility fallback present, and restarted Vite PID 33109 served `/Users/nicholas/Documents/ChatGPT/traveled`. No source, database, credential, admission or existing-photo changes were made for this retry.

The fresh upload created submission `436118eb-5c8d-476a-b228-14a0997c362e` at `2026-10-03 23:34:27.728136+00` (16:34:27 PDT). SQL Editor first identified it as the newest test-trip submission during original verification, then confirmed the same ID with `outcome = 'published'`, `original_approved = true`, `candidate_approved = true`, `gps_acknowledged = true`, `gallery_gps_present = true`, and `cleanup_pending = false`. The metadata-safe query returned only these flags, ID and creation time, excluding coordinate values and private metadata.

Original transfer and awaiting original verification were observed directly; successful processing and subsequent stages are confirmed by final approvals, publication and the displayed gallery image rather than separate intermediate-stage captures. This retry **PASSES the requested HEIC GPS preservation gate**. Success with the fresh tab supports an older frontend client having handled the previous GPS step, but the responsible client was not instrumented, so that explanation remains an inference.

Baseline health: all required service flags true, no unfinished/failed jobs, quota pauses, expired leases, pending cleanup or outstanding reservations; storage bytes 6,071,764. Final `public.upload_health()` again reported all required service flags true and all those counts zero, with storage bytes 6,497,546 and admission enabled. The frontend showed zero awaiting completion. Screenshot `/private/tmp/traveled-heic-gps-retry-20261003.jpg` shows the new publication as the first gallery tile and the settled queue; private pixels remain local and are not committed. Older test outcomes/photos were preserved.

Overall release acceptance remains **PENDING** for the separately documented Linux/cross-account/device/interruption and cropped-HEIC compatibility gaps; this successful retry supersedes the prior failure only for the requested camera C GPS rerun.

## Acceptance status

Final local validation passed as above. The unsupported-source fix and HEIC top-level/context changes are reviewable in this worktree; they are not deployed. No schema, API wire contract, or RLS changes were made.

Initial live screenshot `photo-upload-live-check.jpg` shows the first four generated images. Later screenshots and trusted SQL results above supersede the initial unverified health/cleanup/provider status.

Admission remains enabled in the final trusted snapshot; it was not paused by the agent. Window closure requires an explicit operator decision. Retain the published photos, group and trip for inspection. The unsupported pending submission was explicitly canceled, invoking the existing cleanup workflow; no published photos, groups, trips, or local files were deleted. Do not treat the current enabled state or these partial passes as general release approval while required checks remain unresolved.

## Follow-up implementation — 2026-10-04

Release acceptance remains **PENDING**. The operator explicitly chose to keep uploads enabled during this work. No hosted admission, Auth configuration, schema, account, photo, subscription or deployment was changed. Current hosted health and admission state were not available to inspect.

### Revision and historical evidence

- This checkout, local `main`, and the existing frontend's checkout resolve to `def6e06c7e555d9307645eb23ed4a459cccbdddf`. New work below is uncommitted and is not included in that revision.
- GitHub confirms [PR 21](https://github.com/nicholas-deSouza/traveled/pull/21) merged. Its reviewed head `ec0b9b9c2f901f7e72c1c538375cf0f8ac2bb946` passed [CI run 80](https://github.com/nicholas-deSouza/traveled/actions/runs/37161409875): tests/lint/build, disposable SQL/real Storage gates, and Linux native packaging. The packaging job did not decode the new real HEIC corpus. No workflow runs were returned for merge revision `def6e06`; do not assign the head's evidence to a different revision.
- The later “Verify HEIC upload release flow” chat records a successful fresh-tab retry: both approvals, GPS acknowledgement, non-null gallery GPS, settled queue, no pending cleanup and healthy reservation/job counts. This supersedes that chat's initial null-GPS result. It is historical live evidence, not a new hosted check performed today. Earlier statements here that the metadata fix was unmerged are historical; its implementation is now on local `main`.
- The queue-hiding change and classifier dependency installs in CI/Greploop are already present. Their local regressions pass.

### Implemented locally

- New account-security migration replaces global authenticated profile visibility with self/current-shared-group visibility. Its private helper derives the caller from Auth, qualifies its references, fixes its search path and restricts execution. Own-profile mutations and member-name joins remain supported.
- The private invoker signup hook rejects malformed, non-ASCII/emoji and oversized email identifiers during creation. Valid plus addressing and SQL-word-containing emails remain allowed. Local config enables it; hosted activation still requires applying the migration and selecting the hook. Login, existing email changes, display names and password characters are outside this hook's policy.
- New SQL assertions cover enumeration, roster joins, self/peer mutations, invitations, multiple shared groups, membership removal, historical trip creation, null identity, anonymous access, helper ACLs and signup policy execution as `supabase_auth_admin`.
- Legacy group assertions now model trusted server publication rather than obsolete client gallery writes. Database CI executes group, trip-color, account-security and upload/queue suites, then a localhost-only account HTTP gate and existing Storage gate. HTTP tests use real user tokens for profile reads and the application's exact PostgREST roster embed. Invalid direct signup and unrelated service failures cannot count as enforcement passes.
- Public HEIC corpus harness pins upstream revision/blob identities and checks still decoding, auxiliary alpha, crop/padding dimensions, metadata stripping and pixel rotation. Browser worker tests add pixel-limit and decoder-context cleanup coverage.
- Ordinary artifact CI exercises the supported corpus and reports the pinned 1.23.2 crop incompatibility as BLOCKED. Manual CI release validation additionally passes `--require-crop`, making crop failure fatal. A green ordinary run is not full HEIC release acceptance.

### Checks performed

| Check | Result and limitation |
| --- | --- |
| `pnpm test` | PASS: 199 Vitest + 117 Node script + 25 classifier tests = 341; component/test pairing passes |
| `pnpm lint` | PASS |
| TypeScript and production bundle | PASS with temporary type caches and Vite `envDir:false`, no config-file loading, fresh temporary output, and actual worker/WASM assets. Normal build initially failed on unavailable dependency links; equivalent build avoids reading `.env` |
| Classifier build/native smoke | PASS on macOS Node25; synthetic JPEG/PNG/WebP and WASM initialization only |
| New SQL and account HTTP integration | BLOCKED locally; assertions are executable in disposable Supabase CI but not run here |
| Real HEIC corpus | NOT RUN locally; shell downloads fail DNS, GitHub connector binary reads fail UTF-8 decoding |
| Isolated browser checker | Import transforms PASS; actual browser cases BLOCKED by localhost bind EPERM, including escalation |
| Current hosted/device/provider checks | NOT RUN; no connected Supabase session, valid signed-in app session, device set or provider test facility. Browser bridge reaches the app but its atlas/upload refresh reports `JWT issued at future` |

Dependency installation from the root lockfile failed DNS even with escalation. Existing local dependencies were reused without changing lockfiles; classifier `npm ci` succeeded from available packages. Supabase CLI installation also failed DNS. Migration tooling was unavailable, so the new filename uses the current UTC timestamp; the migration has not been applied. Postgres.app `initdb` failed `shmget` with OS permissions both normally and escalated. Docker is unavailable. A fresh independent reviewer found a dollar-quote delimiter collision in the hook; it was corrected before final validation. Source review is not a substitute for database execution, so the privacy finding remains verification-blocked.

### Remaining release gates

| Cases | Work still required |
| --- | --- |
| Account security | Execute new SQL/HTTP gates; apply migration and activate hosted hook; verify confirmation, correct/wrong password login, recovery, expired/reused links, redirects, rate limits, configured password protection and account switching with disposable accounts |
| H01–H07, I01–I04 | Retain final-revision live format/output/GPS evidence; complete mirrored/oriented/auxiliary/multiple-photo and unsupported/animated corpus cases. Install and verify a pinned corrected decoder in browser and classifier without relaxing limits |
| R01–R05, C01–C06 | Complete precise live interruption, tab-close, offline/reselection, cancellation, competing-tab/manual-retry and cross-account stages; deterministic unit coverage is not a live pass |
| S01–S04, O01–O04 | Run new disposable SQL/real API checks and hosted A/B/C isolation; verify physical temporary-object removal and reservations against a fresh baseline. Capacity, expiry, races and retry exhaustion remain isolated tests |
| M01–M07 | Fresh deployed-model/request audit, representative moderation corpus and actual quota behavior through an approved facility or natural exhaustion; do not manufacture exhaustion with repeated uploads |
| H03 / Linux | Decode the reviewed corpus in the packaged Linux x86_64 Node24 artifact, including strict `--require-crop`; packaging initialization alone is insufficient |
| B01 | Execute isolated browser cases and current Chrome/Firefox/Safari, iPhone/iPad/Android and constrained-device checks |
| Acceptance | Retain successful CI/deployment links for the final tested revision; inspect fresh health and sustained cleanup observations. Keep admission enabled per operator choice; do not claim general release acceptance until every required gate passes |

Upstream publishes [libheif-emscripten 1.23.5 builds](https://github.com/catdad-experiments/libheif-emscripten/releases/tag/v1.23.5), while the npm `libheif-js` package inspected remains at 1.23.2. Fetching a corrected build or rebuilding it locally was not feasible here. No decoder dependency, runtime behavior, security limit or stored GPS was changed.

A final browser-bridge check reached the existing signed-in frontend despite shell HTTP failures. Its atlas and upload refresh show `JWT issued at future`; no token contents were read and no sign-out or account change was performed. The panel correctly keeps unsupported-file failures visible with zero awaiting completion. The official 1.23.5 release asset list loaded, but its archive download timed out; no downloaded build was available to verify or install. The app session requires reauthentication/clock diagnosis before current live gates can run. Earlier “no browser session” observations describe the initial inventory, not this later navigation.

## Approved fixes and current hosted checks — 2026-10-04

This section supersedes earlier unavailable-session and decoder-download observations. The user restarted the project and explicitly approved hosted security changes, disposable test data, and a review-branch commit/push. The listening Vite process on port 5174 has this worktree as its working directory. Release acceptance remains pending broader device/live-stage and final-revision CI/deployment evidence.

- Clear now preserves account-scoped dismissal/recovery metadata across delayed logout/login, while releasing bytes, aborting work, closing the store and replacing the provider on account changes. Tests cover delayed login, account switch/return and late responses. Live Clear followed by reload kept the old outcomes hidden; this is not a live logout/login pass.
- Map regression coverage exercises rendered features, overlapping thumbnails, duplicate tile features and zoom-out URL cleanup. The actual browser showed independent SF/LA dots at regional zoom and two separate thumbnail links at close zoom.
- All eight generated-image worker checks passed through the existing Vite server. The separate checker server still cannot bind a port; using the already-running server avoids that environment limitation.
- The official 1.23.5 archive downloaded through the browser, and its SHA-256 matched `0fa8629a75344389f0da842f659cc952ecaa39cde400eed42b80e4a82a3af778`. The fix uses reviewed vendored factory/WASM/license/provenance rather than the incompatible npm 1.23.2 build. Ordinary Linux artifact CI is strict, not manual-only.
- A rollback-only hosted candidate transaction verified self/peer isolation, roster joins, self update, denied peer update, membership revocation, null identity, ACLs and hook function behavior. Hosted `postgres` cannot impersonate `supabase_auth_admin`; function behavior was tested as owner, with separate ACL and actual Auth invocation checks. No fixture users remain.
- The approved privacy migration was committed through SQL Editor: RLS remains enabled; unrestricted authenticated profile reads are replaced by self/current-group-peer reads. The private signup hook was enabled in Authentication → Hooks. A password-free synthetic OTP probe returned the exact custom rejection, proving hosted Auth invoked the hook. This project has no `supabase_migrations.schema_migrations` table; the manual application was not recorded as a fabricated migration baseline.
- A mixed synthetic JPEG/text live batch rejected text locally and published exactly one JPEG. Refresh was exercised at the displayed publication stage. At `2026-10-04T22:07:58Z`, the test trip had 16 photos (15 before this batch), the latest submission had both approvals and one gallery row, and original/candidate objects were marked removed with zero corresponding Storage metadata rows. This is not an independent physical-object download/404 proof.
- Post-rollout health: queues/cron/pg_net/scheduled true; unfinished, failed jobs, quota pauses, expired leases, cleanup pending, oldest ready job and reservations all zero. Admission remains enabled per the user's existing choice. The application roster still displayed the owner name/role after the privacy change.

The published synthetic JPEG remains available for inspection. No gallery photos or other existing application records were deleted. Cross-account HTTP/Storage gates, physical cleanup proof, all interruption stages, actual phone/tablet/Firefox/Safari and constrained-device testing still require their named environments; deterministic coverage and a point-in-time health snapshot do not replace those checks.

Final integrated local validation on 2026-10-04 passed `pnpm test`, `pnpm lint`, both TypeScript projects, and an equivalent production Vite build with environment-file loading disabled. The regular `pnpm build` was not used because this task must not read `.env` files. The build retains the existing large-chunk warning.

The complete content-addressed upstream HEIC corpus passed with libheif 1.23.5 in both classifier WASM and the browser-worker realm: still rainbow, auxiliary alpha, clean-aperture crop, 1×1 conformance-window padding, and a quarter-turn rotation pixel comparison. The actual browser file chooser also decoded both public crop and padding fixtures; all ten accumulated real-worker checks passed. Linux Node24 artifact and disposable Supabase integration results remain CI gates, not local claims.
