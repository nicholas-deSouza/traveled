# Photo upload pipeline deployment and verification

The implementation follows [ADR 0002](adr/0002-photo-upload-pipeline.md) and the [implementation plan](../plans/2026-09-30-photo-upload-pipeline-implementation.md). Admission defaults to disabled. Keep general admission disabled until the validation gates below pass; live end-to-end tests require a coordinated temporary admission window.

Use the [ordered release checklist](photo-upload-release-checklist.md) to execute the gates and record each result. The [2026-10-03 validation record](photo-upload-release-results-2026-10-03.md) distinguishes local checks, deployment evidence, and pending live/device checks. A green deployment is not release acceptance.

For repeatable deployment through GitHub runners, follow [GitHub Actions setup](photo-upload-actions-setup.md). A push to `main` with deploy-relevant backend changes automatically starts the deployment workflow; documentation-only and unrelated UI changes do not. Manual dispatch remains available for reruns. The workflow validates the already-applied migration, deploys the classifier and Edge Functions, configures runtime secrets/Vault/Cron, and checks backend health. It leaves admission paused for the live release gates.

## Dependencies and validation gates

Use Node 24, pnpm 10.18, Docker, Supabase CLI, AWS CLI and AWS SAM CLI. Discover installed CLI commands through `--help` before using them. This checkout initially had no Docker/Supabase/SAM/AWS CLI. PostgreSQL 13 binaries could not initialize a disposable database because the host denied the required System V shared-memory segment, including an mmap configuration attempt.

As of 2026-10-01, browser and classifier dependencies are present and both lockfiles are generated. Browser frozen lockfile validation and production build pass. The classifier lockfile matches the pinned dependencies, includes Linux x86_64 Sharp/libvips packages, and has registry URLs and integrity hashes. Classifier compilation and local macOS Sharp/libheif smoke pass. The [Linux classifier artifact job on PR #12](https://github.com/nicholas-deSouza/traveled/actions/runs/36948376301/job/110655529391) passed before the CI routing update; the SQL cleanup fixture correction still needs a CI rerun.

For a reproducible dependency install and local validation, run:

```sh
pnpm install --frozen-lockfile
npm ci --prefix infrastructure/photo-classifier --include=optional --ignore-scripts
pnpm test
pnpm lint
pnpm build
npm run build --prefix infrastructure/photo-classifier
npm run smoke --prefix infrastructure/photo-classifier
```

Retain both reviewed lockfiles with the change. CI deliberately requires a frozen browser lock and a reviewed classifier lock. Local unit tests use injected I/O and verify behavior without live services or credentials. Local native smoke proves the installed macOS codecs load and process synthetic JPEG/PNG/WebP, including oversized-source conversion; without a HEIC fixture it checks libheif WASM initialization only. The packaged Linux smoke and representative real HEIC release checks remain required.

Current local results (2026-10-01): `pnpm test` (177 tests) and `pnpm lint` pass after the CI routing and SQL fixture changes. Production build passes with a fresh temporary output directory; the default build cannot clear the existing `dist` because of a filesystem permission error. Classifier build/local native-WASM smoke and browser frozen lockfile validation passed earlier. Database/Storage integration and the packaged Linux native smoke have not run locally because Docker remains unavailable. The `upload-database` and `classifier-artifact` jobs in `.github/workflows/ci.yml` provide those environments on GitHub-hosted Ubuntu runners; local Docker installation is optional when using CI. The workflow changes and source must be committed and pushed before GitHub can run them.

CI additionally starts a disposable local Supabase for `supabase/tests/photo_upload.sql` and `scripts/check-upload-storage.mjs`. The Storage harness rejects non-localhost targets and obtains ephemeral keys through its process environment; it never reads .env. It exercises real Storage/RLS transfers, withholding the original and copied gallery object, immutable uploads, metadata/GPS commit and physical cleanup. Classifier approval is injected through the service-only RPC for this test, so real provider behavior remains a separate gate. The older groups SQL tests assert the previous direct-upload policies; run those against migrations 0001–0003, and the upload tests against the full schema.

Normal CI runs on PRs, pushes to the default branch (`main`), and manual requests. The existing checks job selects the heavier jobs using `scripts/ci-upload-changes.mjs`: Supabase schema/functions/tests, Storage harness and client upload boundary changes select database integration; classifier source, deployment assets, fixtures and lockfile changes select Linux artifact validation. Shared contracts, root dependencies and CI routing changes select both. Documentation-only and unrelated UI changes skip those environments. PR selection covers the whole branch diff, including earlier commits; manual runs and unavailable diff history run both gates. Heavy jobs wait for normal checks to pass. Greploop remains tied to its existing review-comment/manual events, with PR labeling on opening.

The SQL suite's metadata-only fixtures are uncommitted and rolled back. Its simulated cleanup uses `storage.allow_delete_query` only around deletion of the exact claimed bucket/path pairs, then restores and checks the Storage deletion guard. No application migration enables that override. Physical file deletion is exercised separately through the Storage API in the integration harness.

Before release, run the packaged Linux x86_64 Sharp/libheif smoke with a redistributable HEIC fixture, including orientation and auxiliary images. Test ordinary travel/swimwear photos, threshold uncertainty, malformed provider results and actual free-account allowance exhaustion. Validate quality and memory behavior on the group's phones, tablets and desktops, including browser WebP support, refresh/reselection, offline recovery, multiple tabs, cancel during publication and late transfers.

## Services and configuration

Browser workers optimize gallery WebP and run an advisory precheck. Supabase Auth/RLS authorize users; Postgres holds authoritative identities and jobs; Storage holds quarantine and gallery objects; Queues provide durable wakeups; Cron/pg_net invoke the worker; Edge Functions dispatch and publish. AWS Lambda reads immutable private bytes and calls Sightengine. AWS IAM restricts invocation. SAM/CloudFormation deploy Lambda, CloudWatch receives operational logs, and the supplied deployment template resolves an existing Secrets Manager secret for credentials. Secrets Manager is a deployment provisioning dependency; the Lambda runtime does not call it.

WebP optimization prefers native canvas encoding and loads the bundled `@jsquash/webp` WASM encoder inside the worker when the browser returns PNG or native encoding fails. Safari no longer requires native WebP encoding. Resizing, quality 80, the 8 MiB candidate limit, and both server verification checks still apply. Deploy the frontend bundle with its generated WASM assets to release this fix. Run `pnpm test:upload:browser` and open the printed local URL in Safari before release; the command builds into a fresh temporary directory and serves only production assets. The page checks the real worker and forces the bundled fallback using generated pixels without calling live services. The local script suite also checks that both emitted codec URLs resolve to valid WASM files.

Account-scoped upload metadata survives logout for recovery and dismissal. After successful server reconciliation, finished records older than seven days are removed from IndexedDB and memory, matching the server's finished-result window. Unfinished records and records with pending server cleanup are retained; recent dismissed outcomes remain hidden across polling and login.

Provision secrets through your existing approved secret-management process. Never paste values into repository files, command arguments, logs, browser configuration or this document. The Lambda deployment needs the public `SUPABASE_URL` and an existing Secrets Manager ARN whose JSON contains `SUPABASE_SECRET_KEY` (the backend `sb_secret_` key), `SIGHTENGINE_API_USER` and `SIGHTENGINE_API_SECRET`. See [classifier packaging and IAM instructions](../infrastructure/photo-classifier/README.md).

The Edge runtime requires `PHOTO_UPLOAD_WORKER_TOKEN` (at least 32 characters), `PHOTO_CLASSIFIER_AWS_REGION`, `PHOTO_CLASSIFIER_FUNCTION_NAME`, `PHOTO_CLASSIFIER_AWS_ACCESS_KEY_ID`, `PHOTO_CLASSIFIER_AWS_SECRET_ACCESS_KEY`, and optionally `PHOTO_CLASSIFIER_AWS_SESSION_TOKEN`. Supabase provides `SUPABASE_URL` and `SUPABASE_SECRET_KEYS`, a JSON dictionary; the runtime requires its `default` entry to contain an `sb_secret_` key. Confirm that dictionary is available in the project's Edge Function secrets before deployment; do not manually set reserved `SUPABASE_*` variables. Privileged RPC and Storage requests use the secret key in `apikey`; Auth verification also sends the user's session JWT in `Authorization`. The secret key still grants the database `service_role` privileges used by these RPCs. See [Supabase key migration guidance](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys). The IAM principal needs only `lambda:InvokeFunction` for the deployed classifier ARN. Both Lambda's `FunctionError` and returned identity/outcome are checked; a successful HTTP invocation alone does not approve a photo.

Set Supabase Vault entries `photo_upload_worker_url` (the deployed worker URL) and `photo_upload_worker_token` through the approved provisioning process. `public.upload_schedule()` installs the one-minute Cron schedule. The worker verifies its dedicated bearer token; the browser upload API independently validates the user's access token through Auth on every request. Neither endpoint relies on browser-supplied identity.

Verify Sightengine's account is on the intended free plan, supports the image-check endpoint/model and has the expected request rate and daily/monthly allowances. Two approved checks consume two operations. The dispatcher serializes calls and waits at least one second after completion; provider minimum delays and quota pauses take precedence. No code automatically upgrades the account.

## Deployment order

1. Pause old uploads during rollout. Back up and inspect the target schema through the existing operational process.
2. Apply the new migration `20261001010000_photo_upload_pipeline.sql` to projects already on migrations 0001–0003. Do not edit applied migrations. Fresh projects use `scripts/prepare-fresh-schema.mjs`, which assembles the schema with the existing historical Storage owner-type correction.
3. Build, verify and deploy the IAM-only classifier using its documented Linux artifact workflow. Deploy `photo-upload` and `photo-upload-worker` with the supplied Supabase function configuration and provision runtime settings.
4. Configure Vault and invoke `public.upload_schedule()` through trusted operator access. Check `public.upload_health()` for Queues, Cron, pg_net and the installed schedule, and confirm the worker can invoke Lambda.
5. Deploy the browser bundle. Verify direct gallery writes and copied-object reads are denied; approved-source recovery requires ownership plus current membership. Existing gallery photos remain accessible.
6. Run the release checks, then enable admission through trusted operator SQL: `update upload_private.settings set admission_enabled = true where singleton;`.

Rollback by disabling admission with the same setting. Leave moderation/publication gates and cleanup workers active. Reopening the old direct-write policies would bypass the accepted moderation boundary.

## Operations and recovery

### Script diagnostics

Operational Node scripts emit JSON diagnostics to stderr with `script`, `stage` and `event`. Failed operations include a stable `code` and a safe explanation. HTTP diagnostics include the status, a content-type category and, for parsed responses, byte count. Local commands report their stage and exit status. SQL emitted by schema preparation and CI outputs remain on stdout or in their designated output files.

For example, a malformed Vault response now identifies the specific operation:

```json
{"script":"deploy-photo-upload","stage":"vault.worker-url","event":"failed","code":"invalid_json","message":"Database configuration returned an invalid response: body is not valid JSON.","status":200,"bytes":18,"content_type":"json"}
```

Use the failing stage and code to distinguish `request_timeout`, `request_failed`, `http_status`, `empty_response`, `unexpected_content_type`, `invalid_json`, `invalid_shape` and `process_failed`. A successful secret write may return no body; database and worker responses must contain valid JSON and the expected fields. An HTTP 500 is a service failure, not a passing Storage access-denial check. CI explicitly reports when unavailable event data or Git history makes it run both validation jobs.

Storage assertions identify the individual check, for example `publication.committed-gallery-readable` with `assertion_failed`. Denial probes require the error code expected for that operation: direct metadata inserts must return HTTP 403 with Postgres code `42501`; immutable uploads can report access denial or an existing object; physical cleanup must report a missing object. An unrelated HTTP 400, invalid JWT, missing bucket or service failure does not pass. Error bodies are read with a 64 KiB limit and are never included in diagnostics.

Diagnostics omit environment values, credentials, request headers, URLs, SQL parameters, response bodies, photo paths and provider/native error text. Do not enable raw response dumps to troubleshoot a failure. Unit tests use injected responses and subprocess fixtures; live Supabase, AWS and Linux native release gates remain necessary after deployment.

Use `public.upload_health()` plus aggregate private job/submission queries to track unfinished work, failed jobs, expired leases, oldest eligible job age, cleanup backlog, quota pauses, project object sizes and outstanding reservations. The budget is 800 MiB across project buckets and outstanding allocations. Initial admission conservatively reserves 48 MiB: 20 MiB original, 20 MiB candidate authorization, and 8 MiB publication. Verified bytes refund reservations; regenerated paths retain their allocations until cleanup.

Server jobs use 120-second leases and bounded 90-second worker requests. Retry cycles have an initial attempt and four retries at 2/4/8/16 seconds plus jitter; quota pauses do not consume attempts. Cleanup progresses independently per object and missing objects count as removed. Exhausted cleanup retries remain discoverable and begin another daily cycle. Operators can invoke service-only `public.upload_retry_cleanup(sid)` for a specific retained cleanup job, after diagnosing the underlying failure.

Unresolved submissions expire seven days after creation. Cleanup records survive trip deletion. Permanent minimal identities/paths catch late uploads and deny resurrection. After terminal cleanup, filenames, source fingerprints, submission GPS and detailed errors are scrubbed; GPS already committed to the gallery remains. Log counts and operational stages only, excluding image bytes, GPS, filenames, signed URLs, provider payloads and credentials.

## Photos paused before upload

If the queue reports `Uploads are paused`, new admission is disabled by the
operator switch; this does not mean project Storage is full. The deployment
workflow disables admission and deliberately leaves it disabled for release
checks. Through trusted SQL Editor access, run:

```sql
select public.upload_health();
```

Confirm `admission_enabled` and the `queues`, `cron`, `pg_net`, and `scheduled`
flags. If admission is disabled, complete the deployment/release checks above,
resolve any worker failures, then re-enable admission using the existing release
step and rerun the health query. Do not bypass the gate just to hide the pause.

`Storage capacity is paused` instead means the application budget cannot cover
another reservation; inspect storage bytes and outstanding reservations.
`Queue is full` means that user's active queue has reached its limit. These
pauses retry automatically without consuming technical retry attempts. Ask the
user to keep the original tab open: pending files remain in that tab's memory,
and a reload may require selecting the same originals again. `Retry failed` is
disabled because these items are waiting, rather than technically failed.
