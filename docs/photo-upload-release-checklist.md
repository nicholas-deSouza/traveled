# Photo upload release checklist

Run these checks in order against the release revision. The frontend may run on localhost against the deployed Supabase project; a custom domain is unnecessary. Use non-sensitive fixtures and a dedicated test trip. Track cases using the [results record](photo-upload-release-results-2026-10-03.md).

## 1. Prepare and establish a baseline

1. Run `pnpm install --frozen-lockfile`, then `npm ci --prefix infrastructure/photo-classifier --include=optional --ignore-scripts`.
2. Run `pnpm test`, `pnpm lint`, `pnpm build`, and `npm run smoke --prefix infrastructure/photo-classifier`. Node 24 is the CI/Lambda target. The local smoke checks JPEG/PNG/WebP and WASM initialization; without a real HEIC fixture it does not verify HEIC decoding.
3. Run `pnpm test:upload:browser` and open the printed URL in each browser. All eight generated-image checks must pass. Supply a single-photo HEIC using the optional file control. The tool imports the real worker, disables .env loading, and makes no Supabase/Sightengine requests. Its HEIC check proves decoding/output limits; use reference photos to check visual orientation and auxiliary handling in the app.
4. Run `node scripts/make-upload-fixtures.mjs` to create disposable JPEG/PNG/WebP, an asymmetric EXIF-orientation-6 JPEG, an artificial GPS 0,0 JPEG, damaged/renamed/unsupported files, and real two-frame GIF/WebP fixtures in a temporary directory. It uses the classifier's pinned Sharp. Use a reviewed, redistributable HEIC corpus for still, rotated/mirrored, auxiliary, and multi-photo cases; never put private photos in CI artifacts.
5. Start the frontend with `pnpm dev`. The operator configures the project URL and publishable key privately and permits the actual localhost callback origin in Supabase Auth. Never use backend keys in the browser.
6. Sign in as A, create a dedicated group and trip, and prepare separate browser profiles for member B and non-member C. Record only account aliases in repository evidence.
7. Through trusted SQL Editor access, run `select public.upload_health();`. Record baseline counts. Require `queues`, `cron`, `pg_net`, and `scheduled` to be true; diagnose existing failures/backlogs before starting.

Admission is a **global switch**, not a test-account allowlist. Coordinate a quiet test window before the operator runs:

```sql
update upload_private.settings set admission_enabled = true where singleton;
select public.upload_health();
```

After the live batch (also after a failure), the operator closes the window:

```sql
update upload_private.settings set admission_enabled = false where singleton;
select public.upload_health();
```

Existing jobs and cleanup continue while admission is paused. Enabling admission for testing does not approve the general release.

## 2. Execute the scenario matrix

Modes: **Live** uses the app and deployed services; **Browser** uses the isolated browser checker; **Isolated** uses injected unit tests or disposable local Supabase. Run boundary/provider injections in isolation, not by changing production credentials or filling production Storage.

| ID | Mode | Action | Required result |
| --- | --- | --- | --- |
| H01 | Live | Upload one generated JPEG; keep the tab open | Original and candidate approve; exactly one gallery record and readable WebP appear |
| H02 | Live | Repeat with PNG and WebP | Correct scene/aspect ratio; no duplicate publication per submission |
| H03 | Live + Linux | Single-photo HEIC, rotated/mirrored HEIC, and one-photo HEIC with thumbnails/depth | Correct scene/orientation; auxiliary images are not mistaken for additional top-level photos |
| H04 | Live + Browser | Small images, portrait/landscape rotation tags, and large valid images | No upscaling; orientation correct; output long edge ≤2560, bytes ≤8 MiB |
| H05 | Live + isolated | GPS photo and photo without GPS | Valid location retained; absent/invalid pairs do not block publication; acknowledgment is a protocol step, not a promised confirmation dialog |
| H06 | Live | Select a valid and invalid file together | Valid selection can proceed; invalid file has its own visible outcome |
| H07 | Live | View an existing gallery photo after deployment | Existing authorized access still works |
| I01 | Live + isolated | Empty, unsupported, renamed non-image, damaged JPEG/PNG/WebP/HEIC | No publication; understandable per-file rejection/failure and eventual cleanup |
| I02 | Isolated | 20 MiB and 50-million-pixel boundaries, just above each | Boundary accepted if otherwise valid; above rejected before unsafe processing |
| I03 | Isolated + fixtures | Animated PNG/WebP, GIF, AVIF, HEIC sequence, multiple top-level HEIC photos | Never published; supported one-photo auxiliary HEIC remains accepted |
| I04 | Isolated | Candidate above 8 MiB, above 2560 long edge, wrong format, EXIF/XMP chunks/flags | Server rejects candidate even if browser validation is bypassed; ICC profiles allowed |
| R01 | Live | Refresh at original transfer, original check, GPS, processing, candidate transfer/check, publication | Same submission resumes; no premature gallery visibility or duplicate commit |
| R02 | Live | Close/reopen tab during those stages | Unapproved original without local bytes asks for reselection; approved original is recoverable with ownership and current membership |
| R03 | Live + isolated | Reselect identical bytes; same name/different bytes; renamed identical bytes | Exact bytes resume; changed bytes fail; renamed matching bytes are accepted |
| R04 | Live + isolated | Go offline during each transfer; reconnect; inject transient failures | Transfer stops/pauses appropriately and resumes; initial attempt plus four automatic retries, then visible manual retry |
| R05 | Isolated | Corrupt recovered bytes or fail recovery download repeatedly | No optimization of mismatched bytes; bounded retries and recoverable failure |
| C01 | Live + isolated | Cancel before admission and during every unfinished stage | Cancellation that commits first prevents publication; already-published photo requires deletion |
| C02 | Live | Cancel remaining with several files | All unfinished submissions reach terminal outcomes; completed photos stay accessible |
| C03 | Live + isolated | Repeated retry and two tabs working on one submission | Stable identity and serialized work; no double publication or stale-generation mutation |
| C04 | Live | Select the same file twice as separate new uploads | Track separate submission IDs; content deduplication is not assumed |
| C05 | Live + isolated | Sign out/sign in while uploading | Private browser resources are released; authorized recovery works without cross-account state |
| C06 | Isolated | Cancel during copy/publication; finish a stale transfer or result afterward | Copied object withheld; tombstones prevent resurrection; cleanup catches late bytes |
| M01 | Live | Observe H01 original and candidate jobs and Sightengine account usage | Real deployed `nudity-2.1` access works; a full upload normally consumes two operations |
| M02 | Live | Ordinary travel/swimwear reference photos | Assess actual provider suitability; do not assume a particular photo's scores in advance |
| M03 | Isolated | Required scores just below/at 0.20 and 0.80 | Below 0.20 approves; 0.20–<0.80 uncertain; ≥0.80 rejected; only valid approvals publish |
| M04 | Isolated | Missing/nonnumeric/out-of-range scores, malformed JSON, HTTP errors, timeouts | Fail closed; technical failure never approves; retries are bounded |
| M05 | Isolated | HTTP 429, `usage_limit`, numeric/date Retry-After | Quota pauses honor provider minimum delay without consuming normal retry attempts |
| M06 | Isolated | Lambda FunctionError, wrong submission/stage/generation/attempt, wrong bytes/digest | Never persists approval for a mismatched result |
| M07 | Live, dedicated | Check free-plan model/allowance; observe natural allowance exhaustion or approved provider test facility | Account remains on intended plan; actual exhaustion pauses safely. Do not repeatedly upload solely to exhaust quota |
| S01 | Live + isolated | Signed-out user and C attempt trip access/uploads | No unauthorized trip access or admission |
| S02 | Disposable Storage | B tries A's quarantine reads/writes, overwrite/upsert and deletion | Quarantine is owner-only; paths immutable; client cannot bypass approval |
| S03 | Disposable Storage | Direct gallery object/metadata writes and reading copied object before publication commit | All denied; authorized gallery access begins only after commit |
| S04 | Isolated | Remove membership or delete trip while upload is unfinished | No subsequent recovery/publication; cleanup remains discoverable |
| O01 | Live + Storage | Observe published/rejected/canceled/deleted temporary objects | Required bytes physically removed, reservations released; no unexplained cleanup backlog |
| O02 | Isolated | Seven-day expiry, expired leases, partial cleanup failure, absent object | Expiry enforced; leases recover; successful partial removals persist; absent bytes count as removed |
| O03 | Isolated | Exhaust cleanup retry cycle and request explicit cleanup retry | Failure stays discoverable; daily cycle/operator retry can recover |
| O04 | Isolated | 100 unresolved uploads and 800 MiB Storage/reservation capacity boundaries | Admission pauses at limits; retries cannot bypass capacity; no need to fill real project |
| B01 | Devices | Current Chrome/Firefox/Safari; representative iPhone/iPad/Android; slow/low-memory device | Supported browsers finish; missing Web Locks/BroadcastChannel/IndexedDB/worker WebP support has a clear message |

For refresh/cancel timing, use the queue's displayed phase and browser network throttling. Record the stage actually reached; if it advances before the action, rerun that case. Use deterministic isolated tests for races that are too short to reproduce manually.

## 3. Observe and retain evidence

For one known test submission, replace `TEST_SUBMISSION_UUID` below in trusted SQL Editor. Queries intentionally omit filenames, GPS, hashes, object paths, provider bodies, and credentials:

```sql
select id, phase, outcome, generation, original_approved, candidate_approved,
       gps_acknowledged, pause_reason, attempts, retry_at, cleanup_pending
from upload_private.submissions where id = 'TEST_SUBMISSION_UUID'::uuid;

select stage, generation, status, attempts, due_at, lease_until
from upload_private.jobs where submission_id = 'TEST_SUBMISSION_UUID'::uuid
order by stage, generation;

select stage, count(*) as tracked_objects,
       count(*) filter (where deleted_at is null) as not_marked_removed,
       sum(reservation_bytes) as reservation_bytes
from upload_private.objects where submission_id = 'TEST_SUBMISSION_UUID'::uuid
group by stage;
```

Health counts are aggregate observations; they do not prove provider approval or physical deletion. Confirm actual Storage API behavior using `scripts/check-upload-storage.mjs` in disposable Supabase. It rejects non-localhost targets and uses ephemeral process-environment keys. It injects classifier approval, so it does not prove real Sightengine access.

Retain links to successful CI checks for the tested revision. Linux packaging alone initializes WASM but does not decode real HEIC: after building the artifact, run `node infrastructure/photo-classifier/test/artifact-smoke.mjs ARTIFACT_DIR HEIC_FIXTURE` **inside the Linux x86_64 Node24 environment**, repeating for reviewed still/orientation/auxiliary fixtures. Inspect the reference scene/orientation; the existing smoke's dimension bounds are not a visual golden-image comparison.

## 4. Accept or stop the release

- Record each case PASS, FAIL, BLOCKED, or NOT RUN; automated coverage is not a live/device pass.
- Required local, SQL/Storage, Linux/real-HEIC, browser/device, real-provider, security, and cleanup gates must pass. Diagnose unexplained failed jobs, expired leases, or stalled work against the baseline; do not demand zero counts for unrelated existing work.
- Confirm the test window is closed. Only after release acceptance may the operator enable general admission with the SQL above and verify one real gallery upload.
- If a gate fails, preserve minimal evidence, pause new admission, diagnose the stage, fix the defect, and rerun that case plus the affected regressions. Leave moderation and cleanup active.
- Test data remains in the dedicated group/trip for inspection. Remove it only through an explicitly approved cleanup operation.
