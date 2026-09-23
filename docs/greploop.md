# Greptile → Codex fix loop

This setup runs on GitHub-hosted Linux runners. It is dormant until you install
Greptile, add the Actions credentials, and merge the setup to the default branch.
Every newly opened PR then receives the `greploop` label automatically. Final
merging is manual.

## Finish setup in GitHub

1. Install the Greptile GitHub App for this repository. In its review settings,
   enable reviews on updates, a GitHub check, confidence scores, and a general PR
   summary comment with the reviewed-commit footer. The committed
   `.greptile/config.json` requests those behaviors. Do not exclude the fix App's
   bot author from reviews. The controller expects `greptile-apps[bot]` and the
   check's App slug `greptile-apps`; see the optional variables below if different.

2. Create a separate private GitHub App for publishing fixes:
   - GitHub account/organization **Settings → Developer settings → GitHub Apps →
     New GitHub App**.
   - Choose a unique name and use the repository URL as the homepage.
   - Disable webhooks; this App only supplies installation tokens.
   - Repository permissions: **Contents: Read and write** and **Pull requests:
     Read and write**. Metadata read access is automatic. No organization or
     workflow-write permissions are needed.
   - Create the App, record its **App ID** (not Client ID), and generate a private
     key. Install it on **only this repository**.

3. In the repository's **Settings → Secrets and variables → Actions**, add:

   | Kind | Name | Value |
   | --- | --- | --- |
   | Repository secret | `OPENAI_API_KEY` | OpenAI API key with API billing available |
   | Repository secret | `GREPLOOP_APP_PRIVATE_KEY` | Complete downloaded PEM private key |
   | Repository variable | `GREPLOOP_APP_ID` | Numeric GitHub App ID |

   Enter credentials directly in GitHub, never in source files, PR comments, or
   chat. CI uses GitHub Actions secrets; it does not need a committed `.env` file
   or Supabase credentials. These jobs lint and compile the application only.

4. In **Settings → Actions → General**, enable Actions and permit the actions used
   by these workflows: `actions/*`, `pnpm/action-setup`, and `openai/codex-action`.
   Organization policy must permit the scoped job permissions in the YAML.

5. Review and merge the setup files into the repository's default branch.
   `issue_comment` uses the default-branch workflow. Controller scripts and prompts
   are fetched from that branch and pinned to the same commit across all jobs.

6. Open a small, non-draft PR from a branch **inside this repository**, authored
   by a user with write access. **Label new PRs for Greploop** automatically adds
   the label and creates the repository label if needed. Existing PRs are not
   backfilled; add the label manually to those. If the review already exists
   before the label is added, go to **Actions →
   Greploop → Run workflow**, select the **default branch**, and enter the PR
   number. The manual trigger evaluates the existing review; it does not request
   a new one from Greptile.

7. Inspect **Actions → Greploop** for the intake, fix, validate, and publish jobs.
   Successful publishing pushes to the PR branch using the App token, which lets
   ordinary CI run on the new commit. Greptile then reviews that commit and its
   summary event starts the next cycle.

8. After the first CI run, configure your main-branch ruleset to require
   **Lint and build** and the actual Greptile check shown on the PR. Consider
   requiring resolved conversations. Greploop itself is a label-controlled worker, not a
   required status check or an auto-merge gate. Before merging, verify the latest
   commit has 5/5, no unresolved findings, and passing required checks. A green
   Greptile check does not necessarily mean a 5/5 score.

## Behavior and boundaries

- The labeling workflow runs only when a PR is opened. It labels all new PRs,
  including drafts and forks, but the fix loop still enforces its eligibility
  checks below. It uses `pull_request_target` for metadata permissions and never
  checks out or executes PR code. Removing the label opts a PR out; later pushes,
  reopening, and marking ready for review do not add it back automatically.
- Greptile's **created or edited general PR comment** triggers intake. Human
  comments and lookalike accounts cannot start it. A manually dispatched run
  requires repository write access. Forks, draft/closed PRs, and PRs without the
  label are skipped. PRs authored by other Apps are currently excluded unless
  GitHub reports write access for that author.
- Intake fetches paginated reviews, comments, checks, and unresolved review
  threads. It requires a completed check from the configured Greptile App on the
  current head plus a scored review for that commit. General summaries must link
  the **full commit SHA** in a `/commit/<sha>` URL. Reviews older than the check's
  start time are not reused. Missing or ambiguous data fails closed after about
  five minutes; it never counts as 5/5.
- Summary findings are sent to Codex even when there are no inline comments.
  Outdated but unresolved threads are also included for reassessment.
- The default budget is **three attempts per PR**, including failed/cancelled
  runs. Each attempt is recorded in a GitHub Actions bot comment before Codex
  runs. There is at most one attempt per commit. Keep those comments: deleting
  them removes the budget history. Duplicate events and workflow reruns do not
  spend additional attempts for the same commit.
- Only regular `.ts`, `.tsx`, and `.css` files below `src/`, plus `index.html`,
  can be published. Maximum: 30 files / 1 MiB patch. Deletions, symlinks, workflow
  changes, agent instructions, dependency/config changes, and database migrations
  require a maintainer. This is enforced in code, not just in the prompt.
- Codex runs without the publishing App credential. Its patch is applied and
  linted/built on a fresh runner. A third runner checks the same immutable patch
  again before getting the publishing credential; it never installs dependencies
  or executes PR application code. PR authors still need to be trusted because
  the fix job executes their checkout and has OpenAI API access.
- The publisher rechecks the SHA and opt-in before pushing. It uses a regular
  fast-forward push, never force-pushes, and disables repository Git hooks.
  A concurrent human push prevents publication. The label is checked immediately
  before publishing; remove it to stop future attempts and cancel an active run
  in Actions if needed.
- After a successful push, only thread IDs Codex reports fixed, belonging to
  files in the patch, are resolved. False positives and unclear findings stay
  unresolved. The controller does not infer resolution just from an old thread.
- A 5/5 score with zero unresolved Greptile threads ends the loop. No merge is
  performed. Automatic merging requires a separate, explicit configuration.

## Optional repository variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `GREPLOOP_MAX_ATTEMPTS` | `3` | Integer 1–10, total attempt budget per PR |
| `GREPTILE_BOT_LOGIN` | `greptile-apps[bot]` | Exact trusted reviewer login |
| `GREPTILE_APP_SLUG` | `greptile-apps` | Exact App slug on Greptile's check run |

The Codex action, `actions/create-github-app-token`, and every use of
`actions/github-script` are pinned to full commit SHAs from their official
repositories. These pins prevent upstream tag changes from silently replacing
the credential-handling action code. To update them, review the official release,
resolve its full commit SHA, update the pin and version comment, and validate the
workflow through a PR. Other actions still reference major-version tags; pin those
as well if your organization requires all actions to be immutable.

## Troubleshooting

- **Nothing starts:** confirm these files are on the default branch, the label
  exists on the PR, and Greptile posts a general summary comment rather than only
  editing the PR description. Dispatch manually after adding a label to an
  already reviewed PR.
- **No completed current review:** inspect the reviewer login, App slug, check
  result, and summary footer. If Greptile changes its output format, update the
  parser and fixture tests rather than accepting an unverified score. Request a
  fresh review from Greptile, then dispatch again if necessary.
- **Missing credentials / unauthorized:** verify App ID, installation, PEM secret,
  repository permissions, and OpenAI API access. The desktop ChatGPT login does
  not configure this workflow's API secret.
- **403 when intake posts an attempt comment:** intake uses the built-in
  `GITHUB_TOKEN`, not the publishing App token. Its job must request
  `pull-requests: write`. After merging a permissions fix, start a new manual run
  from `main`; rerunning an older run uses its original workflow revision. A
  rejected comment does not reserve an attempt. The separate Node 20 deprecation
  warning is not the cause of this API permission failure; do not opt into the
  deprecated runtime to fix a 403.
- **Attempt already used:** inspect that attempt's run and candidate artifact.
  Failed attempts are not silently retried. Fix the blocker and push a new
  reviewed commit; raise the PR budget deliberately if it has been exhausted.
- **Needs maintainer attention / failed validation:** inspect the updated attempt comment and linked logs. The loop
  stops rather than pushing an unvalidated patch. Download `greploop-report` for
  `codex-result.json` when Codex completed; a successfully exported candidate also contains
  `result.json` with Codex's summary and remaining issues. Candidate/input
  artifacts are retained for seven days.
- **Push rejected:** a human updated the branch or a branch rule prevented the
  App from pushing. Do not bypass protections; rebase/fix the PR normally.
- **Thread resolution failed after push:** the validated commit is already on
  the branch. Resolve verified findings manually, then let the next review run.

## Local verification

```sh
pnpm install --frozen-lockfile
node --test .github/scripts/greploop.test.mjs
pnpm lint
pnpm build
```

The automation tests use Node's built-in test runner. There is still no application
test script. They cover review freshness, bot identity, patch policy, attempt
history, and concurrency checks. A real GitHub run is still needed to verify your
Greptile installation's payload format, credentials, and repository protections.

References: [Codex GitHub Action](https://developers.openai.com/codex/github-action/),
[Greptile configuration](https://www.greptile.com/docs/code-review/greptile-config-reference),
[GitHub workflow triggers](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).

## Visible run status

The attempt reservation comment starts with **Greploop: Running** and explains
why the new commit needs another attempt: its confidence score is below 5/5,
unresolved review threads remain, or both. The same comment is updated when the
run finishes, needs maintainer attention, fails, or is cancelled. The workflow
link is authoritative if cancellation prevents the reporting job from running.

No source changes or a proposed patch outside the source allowlist now produce a
**Needs maintainer attention** report, including the reason and Codex's remaining
issues. Validation and publishing are skipped. Configuration changes (including
`eslint.config.js`) still require a maintainer; this reporting change does not
expand the publisher's permissions. Other job failures also produce a status
update with a link to the failure logs.

A separate, deduplicated decision comment explains why intake did not start a new
attempt (already attempted commit, completed review, or exhausted budget). It does
not overwrite an active attempt's status. Failed, blocked, and cancelled attempts
remain consumed. Fix the blocker and push a new commit for Greptile to review;
a fresh dispatch of an already-attempted SHA will not retry it.
