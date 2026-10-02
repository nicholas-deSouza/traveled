# Deploy the photo upload backend with GitHub Actions

The database migration is complete, as reported by the operator. The workflow checks the installed upload schema rather than applying it again. This is useful when a migration was applied through the SQL Editor and is not recorded in CLI migration history.

## What the workflow does

[Deploy photo upload backend](../.github/workflows/deploy-photo-upload.yml) is a manual workflow on `main`. It first runs the full existing CI, including disposable SQL/Storage tests and Linux classifier smoke tests. PRs and pushes continue to run validation; they do not deploy production.

The deployment then pauses new uploads, builds the Node 24 Linux classifier on a GitHub runner, deploys the existing SAM template, reads its Lambda ARN, and checks the dedicated Edge credentials can invoke that function using Lambda DryRun. It sends runtime secrets to Supabase, creates or updates the two named Vault entries, deploys both Edge Functions, probes CORS and authentication, wakes the worker, installs the one-minute Cron schedule, and checks `upload_health()`.

No local Docker, AWS CLI, SAM CLI, Supabase CLI or database password is required for this workflow. GitHub runners provide those tools. Credentials go from GitHub environment secrets directly into the services through environment variables and HTTPS requests; they are not written into repository files or secret-bearing command arguments. Management API error bodies are omitted from logs.

Every deployment leaves upload admission **paused**, including failed runs. It does not deploy the frontend. Existing jobs and cleanup can continue; the authenticated worker probe can process pending real jobs. DryRun checks invocation permission, not Sightengine classification. The [live release checks](photo-upload-runbook.md) remain necessary before enabling uploads.

## One-time configuration

The operator selected account `905418433781` and region `us-east-1`. Prepared role policies and exact console steps are in [AWS access setup](../infrastructure/photo-classifier/access/README.md). The repository's OIDC subject format must be verified before finalizing the role's trust relationship.

1. Create/choose an AWS account and region. Create the Sightengine account and verify access to the accepted moderation model and allowance.
2. In AWS Secrets Manager, create secret `traveled/photo-classifier` in that region containing JSON keys `SUPABASE_SECRET_KEY`, `SIGHTENGINE_API_USER`, and `SIGHTENGINE_API_SECRET`. The Supabase value must be the backend key starting with `sb_secret_`. Enter values in the service console; never paste them into chat or source files. Save its ARN. Hosted Edge Functions use the `default` key in Supabase's automatically supplied `SUPABASE_SECRET_KEYS` JSON dictionary; confirm it exists in the project's Edge Function secrets. Lambda needs this separate single-key copy in AWS. See [Supabase's migration instructions](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys).
3. Create an AWS IAM deployment role trusted by GitHub OIDC. Its trust must restrict `aud` to `sts.amazonaws.com` and `sub` to `repo:nicholas-deSouza/traveled:environment:photo-upload-production`. Give it the deployment permissions required by SAM/CloudFormation for this stack, its artifact S3 bucket, Lambda, the Lambda execution role/`iam:PassRole`, CloudWatch Logs and reading the specific classifier secret. Scope resource permissions to this application wherever AWS supports resource scoping; do not use this role as the Edge invocation principal. See [AWS SAM on GitHub](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/deploying-using-github.html) and [GitHub AWS OIDC setup](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws).
4. Create a separate durable IAM access key for the Edge runtime with only `lambda:InvokeFunction` on the classifier. Before the first deployment, the function ARN is not known. You can provision the key first without invocation access: the initial workflow creates the stack and stops at DryRun. Read `ClassifierArn` in CloudFormation stack outputs, grant invocation on that exact ARN, and rerun the workflow. Preserve the stack name on later deployments so the function ARN remains stable.
5. In GitHub repository **Settings → Environments**, create `photo-upload-production`. Restrict deployment branches to `main`. Populate the variables and secrets below. If you add required reviewers, a workflow will wait for their approval before deployment.

Environment variables (non-secret):

| Name | Value |
| --- | --- |
| `SUPABASE_PROJECT_REF` | The 20-character reference of the project the app uses |
| `AWS_REGION` | The region selected for Lambda and Secrets Manager |
| `AWS_DEPLOY_ROLE_ARN` | The GitHub OIDC deployment role ARN |
| `PHOTO_CLASSIFIER_SECRET_ARN` | The existing Secrets Manager ARN in that account/region |
| `PHOTO_CLASSIFIER_STACK_NAME` | A stable CloudFormation name, such as `traveled-photo-classifier` |

Environment secrets:

| Name | Value |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | A Supabase management token with access to this project: database queries, Edge function deployment and Edge secrets |
| `PHOTO_UPLOAD_WORKER_TOKEN` | A dedicated random token of at least 32 characters; preserve it across normal deployments |
| `PHOTO_CLASSIFIER_AWS_ACCESS_KEY_ID` | The separate durable IAM invocation key (`AKIA…`) |
| `PHOTO_CLASSIFIER_AWS_SECRET_ACCESS_KEY` | That invocation key's secret |

Temporary AWS session keys are deliberately rejected: a persisted session key expires and would stop the worker. GitHub itself uses short-lived OIDC credentials for deployment. The workflow clears any old Edge session token. Use a controlled credential rotation process when changing the invocation key, worker token or classifier secret. CloudFormation dynamic secret references are resolved when the function configuration is updated; simply changing the Secrets Manager value does not guarantee an unchanged stack refreshes the Lambda environment.

The Supabase configuration helper uses the documented [Management API query endpoint](https://supabase.com/docs/reference/api/v1-run-a-query), which is currently beta, with bound SQL parameters for Vault values, and the [bulk secrets endpoint](https://supabase.com/docs/reference/api/v1-bulk-create-secrets). Repeated runs update named Vault secrets and the existing Cron job; they do not add migrations or weaken RLS. Validate endpoint compatibility if Supabase changes those APIs.

## Run it

Once the workflow and associated code are committed, reviewed and present on `main`, open **Actions → Deploy photo upload backend → Run workflow**, choose `main`, and run it. No remote deployment has been executed while adding these files.

After a green deployment, complete the real HEIC/provider, browser recovery and Storage security release checks in the runbook. Then use trusted Supabase SQL Editor access:

```sql
update upload_private.settings set admission_enabled = true where singleton;
select public.upload_health();
```

Verify a real photo uploads and appears in the gallery. If rollout fails, leave admission paused and inspect the failing stage. The workflow is repeatable for future backend releases, not just initial setup.

## Setup checklist

- [x] Apply the database migration (operator-reported complete).
- [x] Choose AWS account `905418433781` and region `us-east-1`.
- [x] Configure the GitHub OIDC provider, role `github-traveled-deploy` and policy `TraveledPhotoUploadDeploy` (operator-reported complete; live access not yet verified).
- [x] Verify the repository's OIDC subject and update the role's trust relationship for `photo-upload-production`: `repo:nicholas-deSouza@64615525/traveled@1358355406:environment:photo-upload-production` (GitHub settings supplied by operator; AWS policy update operator-reported complete; live role assumption pending deployment).
- [x] Create Sightengine account and obtain API credentials (operator-reported complete).
- [x] Confirm both Sightengine `api_user` and `api_secret` are stored under the required AWS secret fields (operator-reported complete).
- [x] Confirm Sightengine Free plan allowance: 500 operations per day and 2,000 per month (operator-reported complete; live `nudity-2.1` access remains a release check).
- [x] Create Secrets Manager secret `traveled/photo-classifier` with the Supabase and Sightengine credentials (operator reported; values have not been inspected).
- [x] Confirm the AWS secret fields are `SUPABASE_SECRET_KEY`, `SIGHTENGINE_API_USER`, and `SIGHTENGINE_API_SECRET`, with an `sb_secret_` Supabase value (operator-reported complete).
- [x] Confirm the hosted Edge `SUPABASE_SECRET_KEYS` dictionary is listed (operator-reported complete; its `default` entry has not been inspected and will be validated by deployed runtime boot checks).
- [x] Record the secret ARN in GitHub variable `PHOTO_CLASSIFIER_SECRET_ARN` (operator-reported complete).
- [x] Create the separate Edge worker IAM invocation key and add its pair to GitHub environment secrets `PHOTO_CLASSIFIER_AWS_ACCESS_KEY_ID` and `PHOTO_CLASSIFIER_AWS_SECRET_ACCESS_KEY` (operator-reported complete; invocation permission remains pending until the classifier ARN is available).
- [x] Create GitHub environment `photo-upload-production` and configure its deployment variables (operator-reported complete).
- [x] Add GitHub environment secret `SUPABASE_ACCESS_TOKEN` (operator-reported complete).
- [x] Add GitHub environment secret `PHOTO_UPLOAD_WORKER_TOKEN` (operator-reported complete).
- [x] Restrict the GitHub environment's deployment branches to `main` (operator-reported complete).
- [ ] Commit/review/merge the workflow and backend changes to `main`.
- [ ] Run deployment; validate the Edge runtime's modern `default` Supabase key; finish the exact-ARN invocation policy and rerun if bootstrapping.
- [ ] Complete live release checks, including a successful Sightengine `nudity-2.1` request, and deploy the frontend.
- [ ] Enable admission and verify a real gallery upload.
