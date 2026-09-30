# Quarantine and moderate photo submissions before optimization and publication

Date: 2026-09-29

Status: Agreed architectural direction; detailed design remains in progress. This records intended behavior, not an implemented or deployed system.

## Context

Traveled is initially used by its owner and three friends to document their travels. Photos are primarily viewed in the gallery and on the map. Uploads should handle selections of up to 100 photos, remain responsive on phones, continue across app navigation, recover from temporary failures, and prevent photos depicting nudity or sexual activity from being shared.

This is a side project. The upload design must not require a Supabase Pro subscription. Browser processing is selected to avoid that recurring subscription and keep image optimization on users' devices; moderation provider selection and any separate usage costs remain open.

The current implementation uploads original files sequentially, stops on the first failure, and creates a new Storage path on each invocation. It has no moderation gate. Although the existing `trip-photos` bucket is private, its access policies allow group members to read uploaded objects before gallery metadata exists. A private bucket alone therefore does not establish a moderation boundary.

## Decisions and rationale

### Independent browser worker pools

Use two processing workers (pWorkers) and three concurrent upload slots (uWorkers) per browser. On mobile, start with one pWorker and two uWorkers. Each available slot takes the next eligible photo immediately; there is no barrier requiring a group of three uploads to finish together.

Separate pools let processing and network transfer overlap. Lower mobile concurrency limits simultaneous image decoding and network activity. These are initial limits to validate on the group's devices, not globally shared server worker counts.

Optimization may start only after authoritative server moderation approves the source image. The server receives the original rather than an optimized WebP. Browser pWorkers are the selected processing location. The browser then transfers the optimized candidate to quarantine for a final server content check before publication. Browser optimization pauses when the browser is closed and resumes from an approved server source after reopening.

Allow at most 100 unfinished photo submissions in the browser queue, across repeated selections and tabs. Use one active scheduler per signed-in user in a browser, with other tabs sharing its queue. Terminal failures free capacity but remain visible; manual retry must acquire capacity again. Bound the buffer of processed photos so a slow connection cannot cause processing to accumulate large amounts of image data in memory. The exact buffer size and coordination mechanism remain open.

### Optimize for viewing, including HEIC inputs

Support still HEIC images as inputs alongside JPEG, PNG, and still WebP. Users can select original supported phone photos; they do not need to convert files themselves. WebP is the pipeline's optimized output format, not a requirement for the phone's camera format. Start with a maximum long edge of 2,560 pixels, preserve aspect ratio and orientation, never upscale, and encode WebP at approximately 0.8 quality. Extract GPS before stripping embedded metadata so photo locations remain available on the map.

These settings favor gallery quality, lower transfer volume, and lower Storage usage over preserving originals for printing. Validate visual quality and actual encoded size before finalizing the settings. Videos and GIFs are out of scope; do not convert GIFs into still frames. Motion from Live Photos is out of scope. The HEIC decoder, treatment of multi-image HEIC files, and resource limits remain open.

#### Server optimization alternative considered and declined

Trusted server processing could upload the original once, moderate its immutable bytes, optimize that same approved source into WebP, and publish the derivative without accepting replacement image bytes from the browser. It could finish processing while the browser is closed and avoid a second moderation check solely to defend against client substitution. This alternative was declined in favor of browser pWorkers and avoiding a required Supabase Pro subscription for the side project.

The accepted trade-offs are two image transfers for approved submissions, a final server content check on the browser-produced candidate, and browser availability for optimization. Original transfers are larger than precompressed transfers. A custom server optimizer would shift costs and operational work toward backend compute and data transfer; choosing browser processing does not eliminate Storage or moderation usage costs.

Supabase's hosted Edge Functions currently limit each request to 2 seconds of CPU and each worker to 256 MB of memory, and do not support Sharp/libvips. Background tasks do not remove those limits. A custom native image pipeline therefore needs a compatible worker runtime; lighter orchestration can remain in Edge Functions.

Supabase's built-in Storage transformations document HEIC input support, but require Pro or above and limit dimensions to 2,500 pixels, inputs to 25 MB, and resolution to 50 MP. These transform a response at delivery time; storing a permanent optimized derivative would require an explicit trusted read-and-write step. This paid feature is excluded by the subscription constraint. No separate custom optimizer service is selected.

### Separate quarantine and published Storage buckets

Use Supabase Storage for both stages, with a completely separate private quarantine bucket. The intended flow is:

1. Perform a client content precheck for early feedback.
2. Transfer the original image to quarantine with a uWorker.
3. Have the server moderate the actual quarantined source image.
4. Delete rejected images and notify the uploader. Admit only server-approved sources to optimization.
5. Optimize approved images into WebP with a browser pWorker.
6. Transfer the optimized candidate to quarantine with a uWorker, using the same submission identity.
7. Have the server moderate the actual optimized candidate; delete rejected images and notify the uploader.
8. Publish the approved candidate into the gallery's separate bucket and create the gallery entry through a trusted server operation.

The ordering is deliberate: avoid spending optimization resources on an image that fails verification. Decoding an input for classification, including HEIC compatibility, may still be necessary before a verdict; this is distinct from resizing and encoding the final gallery image.

Only trusted server operations may publish. Quarantined photos are not available to other trip members. Any uploader access needed for recovery must be narrowly authorized for the uploader's own submission. Clients must not be able to replace the source bytes during moderation or after approval. The existing direct-write route into `trip-photos` must be closed when the new pipeline is implemented.

The separate bucket makes the trust boundary explicit. Client checks are an advisory precheck intended to speed feedback, while the server is the authoritative decision maker. A client verdict cannot authorize publication or permanently reject a photo without the server decision. The server checks the exact stored image rather than trusting a client-supplied approval or an earlier check of a different file. Cold model load and actual client precheck performance still need measurement.

Browser pWorkers require transferring the original first and the optimized candidate later, using the same upload concurrency pool. Approval of the original cannot authorize arbitrary replacement bytes: a modified browser could substitute an explicit image after approval. The final server check is therefore required for the selected browser-processing design. The initial check still prevents optimization of originals that fail verification; the final check protects the publication boundary from a substituted candidate.

Release the uWorker after each confirmed transfer so later photos can upload while the server checks earlier photos. Show transferred-but-unapproved submissions as awaiting moderation rather than completed. Moderation before optimization reduces wasted processing on rejected sources, but original uploads, second transfers, and final output verification can increase bandwidth and time to gallery visibility.

### Block nudity and sexual activity

Block nudity and sexual activity without exceptions in the initial version. Ordinary clothed and swimwear travel photos are allowed. Uncertain classifications stay withheld with an explanation. Moderation service failures are retryable, but do not permit publication without approval.

This is an automated best-effort filter; perfect detection is not a requirement or a claim. The provider, model, thresholds, and client precheck implementation remain open.

When a photo fails server content verification, delete its image bytes and notify the user that it was not added because it did not pass verification. Do not retain rejected images for review or a retention period. Keep rejected images inaccessible while any failed deletion is retried. Whether minimal submission identifiers and rejection outcomes may remain for notification and idempotency still needs confirmation; these records would contain no image bytes.

### Navigation and recovery

Keep the browser upload manager scoped to the signed-in user and above individual page routes. Uploads continue when navigating within Traveled or switching trips, with progress and controls available across pages. Internal links that currently reload the document must use client navigation to preserve that manager.

Choose server recovery with file reselection (option 1). Keep durable submission identities and outcomes, but do not persist image bytes locally for refresh recovery. On startup, reconcile with trusted server state and reuse the existing submission identity.

Sources fully transferred to quarantine can continue server moderation after refresh. Sources that have not reached the server require reselection. If an approved source is available on the server but browser optimization is still pending, recovery should use that stored source rather than requiring the user to submit it again; the authorized retrieval mechanism remains to be designed.

This choice avoids local storage of up to 100 original photos and the associated quota, cleanup, and cross-tab blob persistence complexity. The trade-off is reselection for images that had not transferred successfully.

Durable server moderation, verification, and publication jobs recover from interrupted execution and continue when their prerequisites are available, even if the browser closes. Browser pWorkers cannot optimize while the browser is closed. With browser processing selected, an approved original awaiting optimization waits until the browser reopens. Once the optimized candidate is fully transferred, final verification and publication can finish without the browser. This explicitly narrows the earlier goal of finishing every quarantined source through publication while the browser is closed.

#### Refresh recovery alternatives considered

Option 1 is selected. The alternatives below record the local persistence trade-off; their recovery boundaries must account for the updated requirement to moderate sources before optimization. All options reconcile with trusted server submission state on startup, reuse submission identities, and avoid retransferring bytes the server already has.

1. **Server recovery with file reselection (selected).** Keep durable submission identities and outcomes, but no local image bytes. After refresh, fully transferred sources continue through server moderation. Pending browser optimization resumes from the approved server source once the browser is running. Sources not transferred require reselection, matched to their existing submissions. This minimizes local storage and browser persistence complexity, at the cost of user intervention for untransferred sources.
2. **Full local persistence.** Save each original file and its submission record to IndexedDB before reporting it as recoverable. After processing, atomically replace the stored original with the optimized WebP and its metadata. On refresh, resume processing or transfer from the last durable stage after checking server state. This provides the most complete automatic recovery, but requires storage for the pending originals, quota handling, account isolation, cleanup, and coordination between tabs. At the current 20 MiB input limit, 100 originals could require roughly 2 GiB before optimization; this is a worst-case calculation, not an expected selection size.
3. **Persist optimized photos only.** Save each optimized WebP and its submission record to IndexedDB before transfer. After refresh, automatically resume transfers for those saved images. Photos that had not finished processing and persistence need reselection. This retains smaller files and avoids repeating completed optimization, while providing partial rather than full recovery.

Local persistence is browser/device-specific, not cross-device file recovery. Browser quotas, cleared site data, and eviction can require reselection even for options 2 and 3. If persistence is selected, unavailable local storage needs an explicit fallback or admission error rather than a false claim that the photo is saved. Clear temporary local image bytes when they are no longer needed, including on rejection, cancellation, and sign-out.

Option 1 is selected for the initial small audience. Options 2 and 3 are retained as alternatives if local file recovery later becomes a requirement; neither is approved for implementation.

### Release workers during retry delays

Allow four automatic retries after the initial upload attempt. Use the requested backoff:

```text
delaySeconds = 1 * 2^n + Uniform(0, 1)
```

Here `n` is the retry attempt, starting at 1. The four delays are 2, 4, 8, and 16 seconds, each plus 0–1 second of random jitter. Release the uWorker immediately after a failed attempt. When the delay expires, return the same submission to the eligible queue; a successful upload completes its transfer stage. Server-requested minimum retry delays take precedence.

Automatic and manual retries reuse the same submission identity and must not create overlapping attempts, repeat already-completed stages, or create duplicate gallery entries. Users can intentionally submit the same image again later. See [ADR 0001](0001-photo-submission-identity.md).

Manual Retry cancels a scheduled retry timer and makes the same submission eligible immediately, subject to capacity, an existing active attempt, and server-requested minimum delays. After automatic retries are exhausted, an explicit manual retry starts another four-retry cycle. A content rejection is a permanent outcome, not a transient upload failure to retry automatically.

Whether four retries applies separately to each retryable stage or across the entire submission remains open. A 60-second cap is not part of the accepted backoff formula.

### Progress and cancellation

Provide per-photo progress, Retry failed, cancellation of individual submissions, and cancellation of the remaining selection. Published photos remain when the remaining queue is canceled. Signing out stops browser work and clears account-scoped browser state.

These controls let one rejected or failed photo leave other submissions progressing. The server serializes cancellation against publication: cancellation prevents publication if it wins; an already-published photo requires the separate delete action. Recheck current trip access before publication and stop submissions whose uploader no longer has permission, including when the trip no longer exists.

Quarantine cleanup and expiry for canceled, abandoned, or unresolved submissions remain open. A moderation service outage is distinct from a content rejection; its retention and retry behavior must be specified without publishing unchecked photos.

## Remaining design work

- Define authorized recovery from approved server sources and reselection matching for sources that did not transfer.
- Select the cross-tab scheduler ownership and recovery mechanism.
- Choose and validate the client and server moderation implementations, including original HEIC input compatibility, final WebP verification, latency, and usage costs within the side project's budget.
- Define HEIC conversion and multi-image behavior, file size and pixel limits, and the processed-image buffer size.
- Decide retry budgets per stage versus per submission, and define offline handling.
- Select the durable server job mechanism for moderation, publication, and cleanup.
- Specify idempotent publication and metadata creation, including cancellation and uncertain request outcomes.
- Confirm whether minimal records may remain after rejected image bytes are deleted; define canceled, abandoned, and unresolved quarantine expiry.
- Define how uncertain moderation scores become a final verification failure versus a temporary unresolved outcome.

## References

- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control): Storage authorization is enforced through RLS policies.
- [Supabase private buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals): private object reads also require authorization.
- [MDN IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API): browser persistence can store files and blobs.
- [MDN browser storage quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria): persisted browser data has quota and eviction constraints.
- [Google WebP overview](https://developers.google.com/speed/webp): WebP supports lossy compression and browser display.
- [Apple HEIF capture formats](https://support.apple.com/en-us/116944): iPhone photos may be HEIF/HEIC or JPEG depending on capture and sharing settings.
- [Supabase Edge Function limits](https://supabase.com/docs/guides/functions/limits): CPU, memory, and native library constraints for hosted functions.
- [Supabase background tasks](https://supabase.com/docs/guides/functions/background-tasks): background execution is still subject to runtime limits.
- [Supabase Storage image transformations](https://supabase.com/docs/guides/storage/serving/image-transformations): managed HEIC input conversion, dimensions, plan requirements, and delivery-time transformation behavior.
