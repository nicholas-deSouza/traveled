# Implement ADR 0002: photo upload pipeline

Date: 2026-09-30
Status: Implementation and local validation complete; database and Linux native artifact validation pending
Source: [ADR 0002](../docs/adr/0002-photo-upload-pipeline.md)
Scope: tested code, new migrations, deployment assets, and runbook. Live deployment is excluded.

## Shared foundation

Define typed API contracts for admission, reconciliation, immutable transfer targets, GPS acknowledgment, approved-source recovery, candidate generations, retry, cancellation, and deletion. Client input never supplies moderation verdicts or publication paths. Keep stable submission IDs and generation/attempt checks throughout.

## Parallel ownership

| Owner | Work |
|---|---|
| Backend subagent | New migrations, RLS, Storage reservations, trusted API, Queues/Cron, leases, classification dispatch, publication, cleanup, server tests |
| Lambda subagent | IAM-only synchronous classifier, actual-byte/digest/format validation, HEIC WASM decoding, Sharp classification JPEG, Sightengine, deployment packaging and tests |
| Browser subagent | Account-scoped scheduler, Web Locks/BroadcastChannel, metadata-only IndexedDB recovery, worker processing, buffer/concurrency limits, upload API boundary, retries and tests |
| Coordinator | Shared contracts, authenticated route provider and queue UI, trip enqueue integration, gallery/map refresh, client navigation, package/CI wiring, runbook and integration validation |

Root owns shared contracts, root manifests/lockfiles and CI. Agents own disjoint directories and report interface changes before integration.

## Backend requirements

Keep existing migrations and gallery photos. Add private quarantine with immutable server-owned paths and no client publication writes. Gallery Storage reads require an exact committed photo row plus current membership. Submission/job/object/reservation/tombstone records survive trip deletion.

Reserve project capacity under an 800 MiB budget: 20 MiB per authorized quarantine path plus 8 MiB for publication (48 MiB initial reservation), refund against verified actual bytes without double counting. Acquire durable leases for at most 120 seconds; Edge external calls have a 90-second deadline. Cron runs each minute to recover work, dispatch retries, enforce fixed seven-day expiry, and sweep late objects.

Serialize provider dispatch globally, with at least one second after preceding classification completion before the next invocation. Initial attempt plus four stage-specific retries at 2/4/8/16 seconds plus jitter; quota pauses consume no attempts. Acknowledge queue deliveries after durable completion/reconciliation.

Copy an approved candidate before publication; lock and recheck generation, lease, original and candidate verdicts, GPS acknowledgment, membership, expiry and cancellation before committing the gallery row and cleanup job together. Cancellation uses the same lock. Reconcile orphan copies. Trusted deletion removes visibility before durable Storage cleanup. Missing objects count as deleted; persist per-object progress; exhausted cleanup retries remain discoverable and start a daily cycle. Scrub sensitive submission metadata after cleanup and retain permanent minimal tombstones.

## Lambda requirements

TypeScript, Node 24, Linux x86_64 ZIP deployed with AWS SAM; 2 GiB memory, 60-second timeout, reserved concurrency one. Invoke with a small server-owned Storage reference and digest, never image payloads or arbitrary URLs. Validate actual bytes, identity, formats, size, 50 MP limit, animation and multiple top-level HEIC photos.

Use libheif WASM for HEIC decoding and Sharp for JPEG encoding/non-HEIC inspection. Prepare a full-scene, oriented, metadata-free JPEG only when needed, without cropping/upscaling, maximum long edge 2560, quality 90 and at most 8 MiB. Send candidate WebP directly. Evaluate the ADR's three finite [0,1] nudity scores; below 0.20 approves, 0.20–0.80 is uncertain rejection, 0.80 or above rejects. Invalid/missing results are technical failures. Free allowance exhaustion pauses; never upgrade automatically.

## Browser and UI requirements

Support still JPEG/PNG/WebP/HEIC up to 20 MiB/50 MP; no GIF/animation/multiple-photo HEIC. Lazy NSFWJS advisory precheck has a five-second timeout and never blocks authoritative checking. After source approval, extract GPS and acknowledge complete coordinates or explicit absence before optimizing to WebP quality 0.8, long edge 2560 without upscaling, at most 8 MiB.

Desktop/tablet: two processing slots, three upload slots, three candidate buffers/24 MiB. Phone: one processing slot, two upload slots, two buffers/16 MiB. Reserve 8 MiB before processing; include uploading and retry-retained candidates. Release workers during delays. At most 100 unfinished submissions across tabs.

Use Web Locks and metadata-only BroadcastChannel for account scheduler/slot coordination. Keep file/blob bytes only in their originating tab's memory; coordinate follower-local work through metadata grants. Persist metadata only in IndexedDB. Reconcile on startup/leadership/connectivity/uncertain responses. Recover approved sources from the server or require matching SHA-256 and byte-size reselection. Block admission with a compatibility explanation if required browser APIs are unavailable.

Mount the manager above authenticated routes with account-keyed lifetime and existing session outlet context. Show stage progress, recovery, retries, pauses, per-item cancel, cancel remaining and Retry failed. Sign-out clears browser state and stops work. Queueing does not mean published. Refresh gallery/map on publication/deletion without discarding mounted blob caches; internal links use client navigation.

## Validation and delivery

Test RLS isolation, forbidden direct writes and precommit reads; quotas/reservations; duplicate requests, stale generations/leases; publication/cancellation races; membership/trip deletion, expiry, late objects and tombstones. Test Lambda score boundaries, malformed/quota failures, digests, supported formats, HEIC and deployed Linux artifact. Test browser pools/buffers, retry/offline behavior, cross-tab ownership, recovery/GPS, reselection and sign-out. Add adjacent component behavior/accessibility tests and update existing Node VM mocks.

Run pnpm test, pnpm lint and pnpm build. Wire full CI and disposable database/Storage integration plus Lambda artifact smoke checks. Document any checks unavailable locally (Supabase CLI, Docker, AWS CLI and SAM initially absent).

Provide a runbook listing prerequisite tools, non-secret configuration names, IAM, verified provider quotas, migrations, workers and Cron. Roll out by pausing admission, installing backend and closed policies, deploying UI, verifying gates, then enabling admission. Rollback disables admission while keeping the trusted gates closed. Operational counts exclude images, GPS, signed URLs and credentials. Validate representative travel photos and device compatibility before release.

## Implementation handoff

The three implementation tracks and coordinator integration are present in this checkout. The browser manager and global queue UI replace direct gallery uploads; trusted publication/deletion, immutable quarantine policies, durable jobs, reservations, cleanup and tombstones live in the new migration and Edge handlers. The classifier has IAM-only deployment assets and actual-byte validation. CI includes the full local suite, Edge type checks, disposable Supabase SQL/Storage gates and Linux native artifact smoke.

See [the runbook](../docs/photo-upload-runbook.md) for rollout and verification. No live services were changed. Admission remains disabled by default.

Local validation passed on 2026-10-01: `pnpm test` (165 tests), `pnpm lint`, `pnpm build`, classifier build and local native/WASM smoke. Both dependency lockfiles are present and reviewed; browser frozen lockfile validation passed and the classifier lock includes Linux x86_64 native packages. Server behavior tests, browser coordination/recovery tests and classifier unit tests run without live services. Local classifier smoke runs actual macOS codecs on synthetic images and initializes libheif WASM; real HEIC and Linux artifact checks remain separate release gates.

The dependency and classifier compilation blockers are resolved. Local PostgreSQL initialization was blocked by the host's shared-memory restriction, and Docker/Supabase/SAM/AWS tools remain absent. The existing CI jobs can run SQL/Storage integration and packaged Linux native smoke after the changes are committed and pushed. These remain outstanding validation gates. Keep this plan open until SQL/Storage integration and Linux native artifact checks pass.
