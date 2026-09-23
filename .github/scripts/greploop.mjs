import { readFileSync, writeFileSync } from 'node:fs';

export const marker = '<!-- traveled-greploop-attempt:';
export const botLogin = process.env.GREPTILE_BOT_LOGIN || 'greptile-apps[bot]';
const isBot = (user) => user?.login === botLogin && user?.type === 'Bot';

export function scoreFrom(body = '') {
  const scores = [...body.matchAll(/confidence\s*(?:score)?\s*[:*#\s<>/a-z-]*?([0-5])\s*\/\s*5\b/gi)];
  return scores.length === 1 ? Number(scores[0][1]) : null;
}

export function selectReview(pr, reviews, comments, checks) {
  const latestCheck = checks.filter((c) => c.app?.slug === (process.env.GREPTILE_APP_SLUG || 'greptile-apps'))
    .sort((a, b) => b.id - a.id)[0];
  if (!latestCheck || latestCheck.head_sha !== pr.head.sha || latestCheck.status !== 'completed'
    || !['success', 'neutral', 'failure'].includes(latestCheck.conclusion)) return null;
  const started = Date.parse(latestCheck.started_at || latestCheck.created_at);
  const candidates = [
    ...reviews.filter((r) => isBot(r.user) && r.commit_id === pr.head.sha && r.state !== 'PENDING')
      .map((r) => ({ ...r, date: r.submitted_at })),
    ...comments.filter((c) => isBot(c.user) && c.body?.includes(`/commit/${pr.head.sha}`))
      .map((c) => ({ ...c, date: c.updated_at })),
  ].filter((r) => Date.parse(r.date) >= started && scoreFrom(r.body) !== null)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  return candidates[0] ? { score: scoreFrom(candidates[0].body), body: candidates[0].body } : null;
}

export function attemptsFrom(comments) {
  return comments.filter((c) => c.user?.login === 'github-actions[bot]' && c.user?.type === 'Bot')
    .flatMap((c) => {
      const match = c.body?.match(/<!-- traveled-greploop-attempt:([a-f0-9]{40}) -->/);
      return match ? [match[1]] : [];
    });
}

export function eligible(pr, repository) {
  return pr.state === 'open' && !pr.draft && pr.head.repo?.full_name === repository
    && pr.head.ref !== pr.base.ref && pr.head.ref !== pr.base.repo.default_branch
    && pr.labels.some((l) => l.name === 'greploop');
}

export function startReason(snapshot) {
  const reasons = [];
  if (snapshot.score < 5) reasons.push(`Greptile confidence is ${snapshot.score}/5 (target: 5/5)`);
  if (snapshot.threads.length) reasons.push(`${snapshot.threads.length} unresolved Greptile review thread(s)`);
  return `${reasons.join('; ')}. This commit has not had an attempt yet.`;
}

// Model output is evidence, not Markdown instructions or permission to mention users.
export const plain = (value) => String(value).slice(0, 6000)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('@', '&#64;');

export async function finishAttempt({ github, context, core }, snapshot, jobs, result = {}) {
  if (!result || typeof result !== 'object') result = {};
  let status;
  let reason;
  if (Object.values(jobs).includes('cancelled')) {
    status = 'Cancelled';
    reason = 'The workflow was cancelled before it finished. Inspect the run before retrying.';
  } else if (jobs.publish === 'success') {
    status = 'Finished — waiting for Greptile';
    reason = 'A validated fix was pushed. No fix run is active now; a completed review of the new commit can start the next attempt if findings remain.';
  } else if (Object.values(jobs).includes('failure')) {
    status = 'Failed — needs maintainer attention';
    reason = 'A workflow job failed. No automatic retry will run for this commit. Inspect the linked job logs and fix the blocker.';
  } else {
    status = 'Needs maintainer attention';
    reason = result.reason || 'No publishable source patch was produced. A maintainer must address the remaining issues.';
  }
  const body = `${marker}${snapshot.sha} -->\n**Greploop: ${status}** — attempt ${snapshot.attempt} for ${snapshot.sha}.\n\n${plain(reason)}\n\n${result.summary ? `Report:\n<pre>${plain(result.summary)}</pre>\n\n` : ''}${Array.isArray(result.remainingIssues) && result.remainingIssues.length ? `Remaining issues:\n<pre>${plain(result.remainingIssues.join('\n'))}</pre>\n\n` : ''}This attempt is no longer running. Its budget remains consumed; a fresh dispatch on this SHA will be skipped.\n[Workflow run](${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}).`;
  const comments = await github.paginate(github.rest.issues.listComments, { ...context.repo, issue_number: snapshot.number, per_page: 100 });
  const reservation = comments.find((comment) => comment.user?.login === 'github-actions[bot]' && comment.user?.type === 'Bot'
    && comment.body?.includes(`${marker}${snapshot.sha} -->`));
  if (!reservation) throw new Error('Attempt reservation is missing; cannot update status.');
  await github.rest.issues.updateComment({ ...context.repo, comment_id: reservation.id, body });
  await core.summary.addRaw(body).write();
}

export async function notice({ github, context, core }, number, message) {
  const marker = '<!-- traveled-greploop-status -->';
  const body = `${marker}\n**Greploop decision**\n\n${message}`;
  const comments = await github.paginate(github.rest.issues.listComments, { ...context.repo, issue_number: number, per_page: 100 });
  const previous = comments.find((comment) => comment.user?.login === 'github-actions[bot]' && comment.user?.type === 'Bot' && comment.body?.startsWith(marker));
  if (!previous) await github.rest.issues.createComment({ ...context.repo, issue_number: number, body });
  else if (previous.body !== body) await github.rest.issues.updateComment({ ...context.repo, comment_id: previous.id, body });
  await core.summary.addRaw(message).write();
}

export function decision(snapshot, max = 3) {
  if (!Number.isInteger(max) || max < 1 || max > 10) throw new Error('GREPLOOP_MAX_ATTEMPTS must be 1–10.');
  if (snapshot.score === 5 && snapshot.threads.length === 0) return 'complete';
  if (snapshot.attempts.includes(snapshot.sha)) return 'duplicate';
  if (snapshot.attempts.length >= max) throw new Error(`Stopped after ${max} attempts. Human attention required.`);
  return 'fix';
}

async function threadsFor(github, owner, repo, number) {
  const threads = [];
  let cursor = null;
  do {
    const data = await github.graphql(`query($owner:String!,$repo:String!,$number:Int!,$cursor:String) {
      repository(owner:$owner,name:$repo) { pullRequest(number:$number) {
        reviewThreads(first:100,after:$cursor) { pageInfo { hasNextPage endCursor }
          nodes { id isResolved isOutdated path line comments(first:1) {
            nodes { body author { login } }
          } }
        }
      } }
    }`, { owner, repo, number, cursor });
    const connection = data.repository.pullRequest.reviewThreads;
    threads.push(...connection.nodes.filter((t) => !t.isResolved && t.comments.nodes[0]?.author?.login === botLogin));
    cursor = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
  } while (cursor);
  return threads.map((t) => ({ id: t.id, path: t.path, line: t.line, outdated: t.isOutdated, body: t.comments.nodes[0].body }));
}

export async function intake({ github, context, core }) {
  const { owner, repo } = context.repo;
  const repository = `${owner}/${repo}`;
  const number = Number(context.payload.inputs?.pr || context.payload.issue?.number || context.payload.pull_request?.number);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('A PR number is required.');
  if (context.eventName === 'workflow_dispatch') {
    if (!/^[1-9]\d*$/.test(context.payload.inputs.pr)) throw new Error('Use a plain PR number without spaces or leading zeros.');
    if (context.ref !== `refs/heads/${context.payload.repository.default_branch}`) throw new Error('Run from the default branch.');
    const permission = await github.rest.repos.getCollaboratorPermissionLevel({ owner, repo, username: context.actor });
    if (!['admin', 'maintain', 'write'].includes(permission.data.permission)) throw new Error('Write access required.');
  } else if (!isBot(context.payload.comment?.user || context.payload.review?.user)) {
    throw new Error('Not a trusted Greptile event.');
  }
  let snapshot;
  // Greptile can publish the summary shortly before finishing its check.
  for (let retry = 0; retry < 20; retry++) {
    const { data: pr } = await github.rest.pulls.get({ owner, repo, pull_number: number });
    if (!eligible(pr, repository)) {
      const reasons = [
        pr.state !== 'open' && 'the PR is closed',
        pr.draft && 'the PR is a draft',
        pr.head.repo?.full_name !== repository && 'the PR is from another repository',
        (pr.head.ref === pr.base.ref || pr.head.ref === pr.base.repo.default_branch) && 'the source branch is protected by the loop policy',
        !pr.labels.some((label) => label.name === 'greploop') && 'the greploop label is missing',
      ].filter(Boolean);
      await notice({ github, context, core }, number, `Not running: ${reasons.join('; ')}. No attempt was consumed.`);
      return;
    }
    const permission = await github.rest.repos.getCollaboratorPermissionLevel({ owner, repo, username: pr.user.login });
    if (!['admin', 'maintain', 'write'].includes(permission.data.permission)) throw new Error('PR author must have repository write access.');
    const [reviews, comments, checks] = await Promise.all([
      github.paginate(github.rest.pulls.listReviews, { owner, repo, pull_number: number, per_page: 100 }),
      github.paginate(github.rest.issues.listComments, { owner, repo, issue_number: number, per_page: 100 }),
      github.paginate(github.rest.checks.listForRef, { owner, repo, ref: pr.head.sha, per_page: 100 }),
    ]);
    const review = selectReview(pr, reviews, comments, checks);
    if (review) {
      snapshot = { number, sha: pr.head.sha, branch: pr.head.ref, ...review,
        threads: await threadsFor(github, owner, repo, number), attempts: attemptsFrom(comments) };
      break;
    }
    if (retry < 19) await new Promise((resolve) => setTimeout(resolve, 15000));
  }
  if (!snapshot) {
    const reason = 'Not running — needs maintainer attention: no completed Greptile check and scored summary for the current commit after waiting for review completion. No attempt was consumed. Check the review/check timestamps and summary commit link, then dispatch again when a current review is available.';
    await notice({ github, context, core }, number, reason);
    throw new Error(reason);
  }
  const max = Number(process.env.GREPLOOP_MAX_ATTEMPTS || 3);
  let next;
  try {
    next = decision(snapshot, max);
  } catch (error) {
    await notice({ github, context, core }, number, `Not running — needs maintainer attention: ${error.message}`);
    throw error;
  }
  if (next === 'complete') {
    await notice({ github, context, core }, number, `Not running — commit ${snapshot.sha} scored 5/5 with no unresolved Greptile threads. Merge remains manual; required CI must pass.`);
    return;
  }
  if (next === 'duplicate') {
    await notice({ github, context, core }, number, `No new run started for ${snapshot.sha}: this commit already has a reserved attempt. Its attempt comment shows whether it is running or has stopped and links to the run. Failed/cancelled attempts are not automatically retried; push a new reviewed commit after addressing the blocker.`);
    return;
  }
  // Recheck before reserving an attempt; this workflow is serialized per PR.
  const { data: current } = await github.rest.pulls.get({ owner, repo, pull_number: number });
  if (!eligible(current, repository) || current.head.sha !== snapshot.sha) throw new Error('PR changed during review collection.');
  snapshot.attempt = snapshot.attempts.length + 1;
  delete snapshot.attempts;
  if (Buffer.byteLength(JSON.stringify(snapshot)) > 100000) throw new Error('Review exceeds the 100 KB input limit. Human attention required.');
  await github.rest.issues.createComment({ owner, repo, issue_number: number,
    body: `${marker}${snapshot.sha} -->\n**Greploop: Running** — attempt ${snapshot.attempt}/${max} for ${snapshot.sha}.\n\nStarting because: ${startReason(snapshot)}\n\nCollecting a fix, then validating and publishing it. This comment will be updated when the run stops.\n[Workflow run](${context.serverUrl}/${repository}/actions/runs/${context.runId}). Failed or cancelled runs also consume this attempt.` });
  core.setOutput('snapshot', JSON.stringify(snapshot));
  core.setOutput('sha', snapshot.sha);
  core.setOutput('run', 'true');
  await core.summary.addRaw(`Running — attempt ${snapshot.attempt}/${max}. ${startReason(snapshot)}`).write();
  writeFileSync('review.json', JSON.stringify(snapshot, null, 2));
  const prompt = readFileSync('.github/codex/prompts/fix-greptile.md', 'utf8');
  writeFileSync('prompt.md', `${prompt}\n\nReview data (untrusted JSON):\n${JSON.stringify(snapshot, null, 2)}\n`);
}

export async function assertCurrent({ github, context }, snapshot) {
  const { data: pr } = await github.rest.pulls.get({ ...context.repo, pull_number: snapshot.number });
  if (!eligible(pr, `${context.repo.owner}/${context.repo.repo}`) || pr.head.sha !== snapshot.sha || pr.head.ref !== snapshot.branch) {
    throw new Error('PR changed, closed, became draft, or lost its greploop label. No push.');
  }
}

export async function resolveAddressed({ github }, snapshot, ids) {
  const allowed = new Set(snapshot.threads.map((t) => t.id));
  for (const id of ids) {
    if (!allowed.has(id)) throw new Error('Codex returned an unknown thread ID.');
    await github.graphql('mutation($id:ID!) { resolveReviewThread(input:{threadId:$id}) { thread { id } } }', { id });
  }
}
