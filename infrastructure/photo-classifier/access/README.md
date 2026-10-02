# AWS access for photo upload deployment

Operator-selected AWS account: `905418433781`. Region: `us-east-1`.

These files contain public identifiers and policies, not credentials. The operator reports that the GitHub OIDC provider, role `github-traveled-deploy` and policy `TraveledPhotoUploadDeploy` are configured in AWS. Live access and the exact OIDC trust relationship have not been verified. Worker invocation credentials, the classifier secret, GitHub environment configuration and deployment remain on the [setup checklist](../../../docs/photo-upload-actions-setup.md#setup-checklist).

## Deployment role

Create the Web identity role `github-traveled-deploy` for the existing GitHub identity provider. Its ARN, if created without a path, will be `arn:aws:iam::905418433781:role/github-traveled-deploy`.

In **IAM → Roles → github-traveled-deploy → Permissions → Add permissions → Create inline policy**, select JSON and paste [github-deploy-permissions.json](github-deploy-permissions.json). Check the editor's policy validation findings, then name the policy `TraveledPhotoUploadDeploy`.

This policy matches the current [SAM template](../template.yaml) and workflow's `--resolve-s3` behavior. Set the GitHub environment variables:

```text
AWS_REGION=us-east-1
AWS_DEPLOY_ROLE_ARN=arn:aws:iam::905418433781:role/github-traveled-deploy
PHOTO_CLASSIFIER_STACK_NAME=traveled-photo-classifier
```

The stack name is significant: it scopes both generated function and execution-role names. Use it unchanged with this policy. The shared SAM bootstrap stack/bucket is also permitted because the CLI creates it automatically. This role can manage that SAM artifact bucket, including configuration and deletion; if the account already uses the shared bucket for other apps, review its sharing before attaching the policy. Bucket/object access checks the owning account. KMS access is limited to S3-mediated use for SAM artifacts, matching the managed bucket's encryption. Read-only CloudFormation template validation requires a wildcard resource, restricted by requested region. Rollback permissions are included for stack resources. The role can attach only `AWSLambdaBasicExecutionRole` to the generated classifier execution role and pass that role only to Lambda.

The policy expects a Secrets Manager secret named **`traveled/photo-classifier`** in `us-east-1`, using the default Secrets Manager encryption key. It allows reading only that exact secret name with its six-character ARN suffix. If you already chose a different name or a customer-managed KMS key, update the secret ARN and required key permission before deployment. Store the secret's actual ARN as GitHub variable `PHOTO_CLASSIFIER_SECRET_ARN`. Provision its three JSON values using the [deployment setup guide](../../../docs/photo-upload-actions-setup.md).

## Trust relationship

[github-trust-name-format.json](github-trust-name-format.json) restricts role assumption to this repository's `photo-upload-production` environment. **It is the name-based subject example; the repository's actual OIDC subject has not been verified.**

GitHub repositories created after July 15, 2026, renamed/transferred after that date, or opted into immutable subjects use owner/repository IDs in the subject. For that format, replace only the subject value with the actual, verified claim:

```text
repo:nicholas-deSouza@OWNER_ID/traveled@REPOSITORY_ID:environment:photo-upload-production
```

Do not paste these placeholders or substitute a wildcard subject. Verify the actual subject before using the trust policy for deployment. The GitHub CLI metadata/settings lookup was unavailable from this workspace due to network connectivity; neither format has been asserted as this repository's current setting. The [GitHub OIDC reference](https://docs.github.com/en/actions/reference/security/oidc#immutable-subject-claims) describes both formats.

In GitHub, create environment `photo-upload-production` and restrict its deployment branches to `main`; an environment subject itself does not encode the branch. Edit the AWS role under **Trust relationships → Edit trust policy** using the verified subject. The provider ARN and audience are already filled in for this account. See [GitHub AWS OIDC configuration](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws).

## Separate worker invocation access

The deployment role is for GitHub. Create a separate IAM user/access key for the Edge runtime, and grant it only `lambda:InvokeFunction` on the exact `ClassifierArn` from CloudFormation outputs after the first stack deployment. Keep that ARN out of a wildcard invocation policy. The existing setup guide explains the first-run DryRun stop and rerun. Never share an access-key secret in chat or repository files.

Permission references: [CloudFormation](https://docs.aws.amazon.com/service-authorization/latest/reference/list_cloudformation.html), [SAM transform permission](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/control-access-with-iam.html), [Lambda](https://docs.aws.amazon.com/service-authorization/latest/reference/list_lambda.html), [IAM](https://docs.aws.amazon.com/service-authorization/latest/reference/list_iam.html), [S3](https://docs.aws.amazon.com/service-authorization/latest/reference/list_s3.html), [SAM's bootstrap implementation](https://github.com/aws/aws-sam-cli/blob/develop/samcli/lib/bootstrap/bootstrap.py).
