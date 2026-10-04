# Photo classifier

IAM-only synchronous Lambda for ADR 0002. The shared wire types are imported from `src/lib/photoUploadContract.ts`. The request carries a trusted immutable quarantine path, SHA-256 and byte count. The response repeats submission, generation, stage and attempt identity. The caller must check Lambda invocation errors and the response identity/outcome before persisting approval.

The classifier streams private Storage bytes, verifies length and digest, rejects unsupported/animated/oversized inputs and checks `nudity-2.1`. Only three finite scores below 0.20 approve. Technical failure never approves; 429 or explicit quota failures pause. No provider response text or images are logged. No upgrade/billing API is called.

HEIC uses the reviewed upstream libheif 1.23.5 factory and WASM in `vendor/libheif-1.23.5`, with license, release provenance and integrity checks. The factory receives explicitly loaded WASM bytes, avoiding working-directory-dependent lookup. Top-level image count must be one; thumbnails/depth are excluded by libheif's top-level enumeration. HEIF orientation is applied during display. Sharp verifies the other formats and prepares metadata-free, oriented JPEGs for HEIC and inputs above 8 MiB. Still candidate WebP is sent directly after enforcing its 8 MiB cap, 2560-pixel maximum long edge and absence of EXIF/XMP chunks or metadata flags. ICC color profiles are allowed. Originals retain metadata for the later GPS extraction handoff.

## Validation

```sh
npm install --prefix infrastructure/photo-classifier --ignore-scripts
npm test --prefix infrastructure/photo-classifier
npm run build --prefix infrastructure/photo-classifier
npm run smoke --prefix infrastructure/photo-classifier
```

Commit the generated package lock after installing the pinned dependencies, and use `npm ci` thereafter. Dependency installation and native/WASM execution are required release gates. If the lock is absent, container packaging intentionally fails rather than creating an unreviewed deployment.

## Build and deploy

Prerequisites: Docker, AWS SAM CLI, AWS CLI; Linux x86_64 Node24 build image; reviewed package lock. From the repository root:

```sh
mkdir -p infrastructure/photo-classifier/dist/lambda
docker run --rm --platform linux/amd64 --entrypoint node \
  -v "$PWD:/workspace:ro" \
  -v "$PWD/infrastructure/photo-classifier/dist/lambda:/artifact" \
  public.ecr.aws/sam/build-nodejs24.x \
  /workspace/infrastructure/photo-classifier/build-artifact.mjs /artifact
sam validate --lint --template infrastructure/photo-classifier/template.yaml
sam build --template infrastructure/photo-classifier/template.yaml
sam deploy --guided
```

The container copies an explicit source/configuration allowlist and the shared contract; no secret files enter the ZIP. It installs Linux native optional dependencies, verifies and stages the vendored libheif factory/WASM/license/provenance, compiles TypeScript, then executes the packaged Sharp/WASM smoke. Every selected Linux artifact CI job also requires the hash-pinned still, alpha, rotation and crop corpus. Public fixtures are checked into `test/fixtures/heic` with provenance; CI passes this read-only directory through `--fixtures` instead of downloading from GitHub Raw. Missing or changed bytes fail closed without a network fallback. `pnpm test:heic:corpus` and `pnpm test:heic:browser` use the same local fixtures. Node24, x86_64, 2 GiB, 60 seconds and reserved concurrency one are specified in the SAM template. No Function URL, API Gateway event, public invocation policy or image bucket is created.

Before deployment, create an AWS Secrets Manager JSON secret with `SUPABASE_SECRET_KEY`, `SIGHTENGINE_API_USER` and `SIGHTENGINE_API_SECRET`. `SUPABASE_SECRET_KEY` must contain the project's modern backend key starting with `sb_secret_`; the classifier sends it only in the Storage `apikey` header. Supply its ARN and the public project URL as SAM parameters; use the organization's credential provisioning process, never paste secrets into CLI arguments or files in this repository. Secrets Manager dynamic references are resolved by CloudFormation; the deployment identity needs permission to resolve that existing secret. Lambda's execution role requires only CloudWatch logging; the runtime does not read Secrets Manager. Rotate secret values and redeploy the function configuration. The Edge invocation IAM principal needs `lambda:InvokeFunction` restricted to the output `ClassifierArn`; create no public resource policy.

The orchestration service must serialize dispatch globally and wait at least one second after classification completion before invoking again. Reserved concurrency alone is not a rate limiter. Confirm the provider account remains on the free plan and verify its actual daily/monthly operation allowance before enabling admission. Validate HEIC top-level/auxiliary/orientation fixtures and representative phone photos with the built Linux artifact before release. Supply a still HEIC fixture as the third argument to `test/artifact-smoke.mjs` for the packaged decoder check. Never use private travel photos in public CI artifacts.

This checkout's registry DNS access may be unavailable, and Docker/SAM/AWS CLI may be absent. Unit tests use Node's TypeScript stripping and injected I/O so they can run without dependency installation or live services; passing them does not replace the native/WASM and deployed integration gates.

Sources: [libheif-js](https://github.com/catdad-experiments/libheif-js), [Sharp installation](https://sharp.pixelplumbing.com/install/), [SAM function](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-resource-function.html), [Sightengine model](https://sightengine.com/docs/advanced-nudity-detection-model-2.1), [provider throttling](https://sightengine.com/faq/request-throttling), [provider errors](https://sightengine.com/docs/api-error-codes-and-responses).
