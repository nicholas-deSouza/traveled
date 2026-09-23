import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { allowedPath, validateResult } from './greploop-patch.mjs';
import { attemptsFrom, decision, eligible, scoreFrom, selectReview, assertCurrent, intake, finishAttempt, startReason, notice } from './greploop.mjs';

// All fixture subprocesses must be isolated from the committing repository.
function exec(command, args, options = {}) {
  const env = { ...process.env, ...options.env };
  for (const key of execFileSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8' }).trim().split(/\s+/)) {
    delete env[key];
  }
  // Avoid writing fixture output to a real workflow's output file.
  delete env.GITHUB_OUTPUT;
  if (options.env?.GITHUB_OUTPUT) env.GITHUB_OUTPUT = options.env.GITHUB_OUTPUT;
  return execFileSync(command, args, { ...options, env });
}

const sha = 'a'.repeat(40);
const bot = { login: 'greptile-apps[bot]', type: 'Bot' };
const pr = { state: 'open', draft: false, labels: [{ name: 'greploop' }],
  head: { sha, ref: 'feature', repo: { full_name: 'owner/repo' } },
  base: { ref: 'main', repo: { default_branch: 'main' } } };
const check = { id: 1, app: { slug: 'greptile-apps' }, head_sha: sha,
  status: 'completed', conclusion: 'success', started_at: '2026-09-01T10:00:00Z' };
const summary = { user: bot, body: `### Confidence Score: 3/5\nLast reviewed: https://github.com/owner/repo/commit/${sha}`,
  updated_at: '2026-09-01T10:03:00Z' };

test('score parsing accepts Greptile formatting but fails closed on ambiguity', () => {
  assert.equal(scoreFrom('### Confidence Score: 3/5'), 3);
  assert.equal(scoreFrom('**Confidence Score:** **5/5**'), 5);
  assert.equal(scoreFrom('<h3>Confidence Score: 0/5</h3>'), 0);
  for (const body of ['5/5', 'Confidence Score: 6/5', '', 'Confidence: 3/5; Confidence: 5/5']) assert.equal(scoreFrom(body), null);
});

test('review must match the current head, trusted bot, and completed check', () => {
  assert.equal(selectReview(pr, [], [summary], [check]).score, 3);
  assert.equal(selectReview(pr, [], [{ ...summary, user: { ...bot, type: 'User' } }], [check]), null);
  assert.equal(selectReview(pr, [], [{ ...summary, body: summary.body.replace(sha, 'b'.repeat(40)) }], [check]), null);
  assert.equal(selectReview(pr, [], [summary], [{ ...check, head_sha: 'b'.repeat(40) }]), null);
  assert.equal(selectReview(pr, [], [summary], [{ ...check, app: { slug: 'lookalike' } }]), null);
  assert.equal(selectReview(pr, [], [summary], [{ ...check, conclusion: 'cancelled' }]), null);
  assert.equal(selectReview(pr, [], [summary], [check, { ...check, id: 2, status: 'in_progress' }]), null);
});

test('edited summaries supersede earlier reviews, but previous-cycle scores do not', () => {
  const review = { user: bot, commit_id: sha, state: 'COMMENTED', body: 'Confidence: 2/5', submitted_at: '2026-09-01T10:01:00Z' };
  assert.equal(selectReview(pr, [review], [summary], [check]).score, 3);
  assert.equal(selectReview(pr, [review], [], [check]).score, 2);
  assert.equal(selectReview(pr, [review], [summary], [{ ...check, started_at: '2026-09-01T10:04:00Z' }]), null);
});

test('opt-in excludes forks, closed/draft PRs and protected branch destinations', () => {
  assert.equal(eligible(pr, 'owner/repo'), true);
  for (const change of [{ draft: true }, { state: 'closed' }, { labels: [] },
    { head: { ...pr.head, ref: 'main' } }, { head: { ...pr.head, repo: { full_name: 'fork/repo' } } }]) {
    assert.equal(eligible({ ...pr, ...change }, 'owner/repo'), false);
  }
});

test('attempt ledger ignores forged comments', () => {
  const body = `<!-- traveled-greploop-attempt:${sha} -->`;
  assert.deepEqual(attemptsFrom([
    { body, user: { login: 'github-actions[bot]', type: 'Bot' } },
    { body, user: bot }, { body, user: { login: 'github-actions[bot]', type: 'User' } },
  ]), [sha]);
});

test('publisher rejects concurrent pushes and removed opt-in', async () => {
  const snapshot = { number: 1, sha, branch: 'feature' };
  const context = { repo: { owner: 'owner', repo: 'repo' } };
  const client = (data) => ({ rest: { pulls: { get: async () => ({ data }) } } });
  await assertCurrent({ github: client(pr), context }, snapshot);
  await assert.rejects(assertCurrent({ github: client({ ...pr, head: { ...pr.head, sha: 'b'.repeat(40) } }), context }, snapshot));
  await assert.rejects(assertCurrent({ github: client({ ...pr, labels: [] }), context }, snapshot));
});

test('budget persists across commits and completion requires zero unresolved threads', () => {
  const snapshot = { score: 3, sha, threads: [], attempts: [] };
  assert.equal(decision(snapshot), 'fix');
  assert.equal(decision({ ...snapshot, attempts: [sha] }), 'duplicate');
  assert.throws(() => decision({ ...snapshot, attempts: ['b', 'c', 'd'] }), /Stopped after 3/);
  assert.equal(decision({ ...snapshot, score: 5, attempts: ['b', 'c', 'd'] }), 'complete');
  assert.equal(decision({ ...snapshot, score: 5, threads: [{ id: 'unresolved' }] }), 'fix');
  assert.throws(() => decision(snapshot, 0), /must be/);
  assert.throws(() => decision(snapshot, 11), /must be/);
});

test('patch scope blocks credentials, workflows, config, traversal and instructions', () => {
  for (const path of ['src/App.tsx', 'src/lib/utils.ts', 'src/index.css', 'index.html']) assert.equal(allowedPath(path), true);
  for (const path of ['.env', '.github/workflows/ci.yml', 'package.json', 'src/AGENTS.md', 'src/../../evil.ts', 'src/.env', 'supabase/migrations/fix.sql']) assert.equal(allowedPath(path), false);
});

test('thread resolution only accepts snapshot IDs whose files changed', () => {
  const snapshot = { threads: [{ id: 't1', path: 'src/App.tsx' }] };
  const result = { summary: 'Fixed', remainingIssues: [], addressedThreadIds: ['t1'] };
  assert.deepEqual(validateResult(result, snapshot, ['src/App.tsx']), ['t1']);
  assert.throws(() => validateResult(result, snapshot, ['src/other.ts']));
  assert.throws(() => validateResult({ ...result, addressedThreadIds: ['fake'] }, snapshot, ['src/App.tsx']));
});

test('intake collects paginated threads, reserves one attempt and ignores the duplicate event', async () => {
  const previous = process.cwd();
  const temp = mkdtempSync(join(tmpdir(), 'traveled-greploop-intake-'));
  mkdirSync(join(temp, '.github/codex/prompts'), { recursive: true });
  writeFileSync(join(temp, '.github/codex/prompts/fix-greptile.md'), 'Fix reviewed issues.');
  const comments = [summary];
  const outputs = {};
  const endpoints = { reviews: () => {}, comments: () => {}, checks: () => {} };
  let threadPages = 0;
  const github = {
    rest: {
      pulls: { get: async () => ({ data: { ...pr, user: { login: 'maintainer' } } }), listReviews: endpoints.reviews },
      issues: { listComments: endpoints.comments, createComment: async ({ body }) => comments.push({ body, user: { login: 'github-actions[bot]', type: 'Bot' } }) },
      checks: { listForRef: endpoints.checks },
      repos: { getCollaboratorPermissionLevel: async () => ({ data: { permission: 'write' } }) },
    },
    paginate: async (endpoint) => endpoint === endpoints.comments ? comments : endpoint === endpoints.checks ? [check] : [],
    graphql: async (_query, { cursor }) => {
      threadPages++;
      return { repository: { pullRequest: { reviewThreads: {
        pageInfo: { hasNextPage: !cursor, endCursor: 'next' },
        nodes: [{ id: cursor ? 't2' : 't1', isResolved: false, isOutdated: Boolean(cursor), path: 'src/app.ts', line: 1,
          comments: { nodes: [{ body: 'Fix this edge case', author: { login: bot.login } }] } }],
      } } } };
    },
  };
  const core = { setOutput: (key, value) => { outputs[key] = value; },
    summary: { addRaw() { return this; }, async write() {} } };
  const context = { repo: { owner: 'owner', repo: 'repo' }, eventName: 'issue_comment',
    payload: { issue: { number: 1 }, comment: { user: bot } }, serverUrl: 'https://github.com', runId: 123 };
  try {
    process.chdir(temp);
    await intake({ github, context, core });
    assert.equal(outputs.run, 'true');
    assert.equal(threadPages, 2);
    assert.equal(JSON.parse(outputs.snapshot).threads.length, 2);
    assert.equal(JSON.parse(outputs.snapshot).attempt, 1);
    assert.equal(comments.length, 2);
    assert.match(comments[1].body, /Greploop: Running/);
    assert.match(comments[1].body, /Starting because: Greptile confidence is 3\/5/);
    assert.match(readFileSync('prompt.md', 'utf8'), /Confidence Score/);
    delete outputs.run;
    await intake({ github, context, core });
    assert.equal(outputs.run, undefined);
    assert.equal(comments.length, 3);
    assert.match(comments[2].body, /No new run started/);
  } finally {
    process.chdir(previous);
  }
});

test('patch exports and applies in a fresh checkout; deleted files are rejected', () => {
  const temp = mkdtempSync(join(tmpdir(), 'traveled-greploop-'));
  const source = join(temp, 'source');
  mkdirSync(join(source, 'src'), { recursive: true });
  const git = (...args) => exec('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: source, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init');
  writeFileSync(join(source, 'src/app.ts'), 'export const count = 1;\n');
  git('add', 'src/app.ts');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Fixture');
  const fixtureSha = git('rev-parse', 'HEAD').trim();
  const snapshot = join(temp, 'review.json');
  const result = join(temp, 'result.json');
  const artifact = join(temp, 'artifact');
  writeFileSync(snapshot, JSON.stringify({ threads: [] }));
  writeFileSync(result, JSON.stringify({ summary: 'Fixed', addressedThreadIds: [], remainingIssues: [] }));
  writeFileSync(join(source, 'src/app.ts'), 'export const count = 2;\n');
  const script = resolve('.github/scripts/greploop-patch.mjs');
  exec(process.execPath, [script, 'export', source, fixtureSha, snapshot, result, artifact]);
  const fresh = join(temp, 'fresh');
  exec('git', ['clone', '--quiet', source, fresh]);
  exec(process.execPath, [script, 'apply', fresh, fixtureSha, snapshot, result, artifact]);
  assert.match(readFileSync(join(fresh, 'src/app.ts'), 'utf8'), /count = 2/);
  const deletion = `diff --git a/src/app.ts b/src/app.ts\ndeleted file mode 100644\n--- a/src/app.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-export const count = 1;\n`;
  writeFileSync(join(artifact, 'fix.patch'), deletion);
  const another = join(temp, 'another');
  exec('git', ['clone', '--quiet', source, another]);
  assert.throws(() => exec(process.execPath, [script, 'apply', another, fixtureSha, snapshot, result, artifact], { stdio: 'pipe' }), /Only regular source-file/);
});


test('start reason includes score and unresolved findings, even at 5/5', () => {
  assert.match(startReason({ score: 3, threads: [] }), /3\/5/);
  const reason = startReason({ score: 5, threads: [{ id: 't' }] });
  assert.match(reason, /1 unresolved/);
  assert.doesNotMatch(reason, /confidence/);
});

test('final status updates the reservation for blocked, failed, cancelled and published attempts', async () => {
  const snapshot = { number: 9, sha, attempt: 1 };
  const context = { repo: { owner: 'owner', repo: 'repo' }, serverUrl: 'https://github.com', runId: 123 };
  const comments = [{ id: 10, user: { login: 'github-actions[bot]', type: 'Bot' }, body: `<!-- traveled-greploop-attempt:${sha} -->` }];
  const github = { paginate: async () => comments, rest: { issues: { listComments() {},
    updateComment: async ({ comment_id, body }) => { assert.equal(comment_id, 10); comments[0].body = body; },
  } } };
  const core = { summary: { addRaw() { return this; }, async write() {} } };
  for (const [jobs, expected] of [
    [{ fix: 'success', validate: 'skipped', publish: 'skipped' }, /Needs maintainer attention/],
    [{ fix: 'failure', publish: 'skipped' }, /Failed — needs maintainer attention/],
    [{ fix: 'cancelled', publish: 'skipped' }, /Cancelled/],
    [{ fix: 'success', validate: 'success', publish: 'success' }, /Finished — waiting for Greptile/],
  ]) {
    await finishAttempt({ github, context, core }, snapshot, jobs, {
      reason: 'No source changes', summary: 'Blocked by configuration scope', remainingIssues: ['eslint.config.js requires a maintainer. @someone <img>'],
    });
    assert.match(comments[0].body, expected);
    assert.match(comments[0].body, /eslint.config.js requires a maintainer/);
    assert.doesNotMatch(comments[0].body, /@someone|<img>/);
    assert.deepEqual(attemptsFrom(comments), [sha]);
  }
});

test('no patch and forbidden configuration produce a maintainer report without an exportable patch', () => {
  const temp = mkdtempSync(join(tmpdir(), 'traveled-greploop-blocked-'));
  const source = join(temp, 'source');
  mkdirSync(source);
  const git = (...args) => exec('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: source, encoding: 'utf8', stdio: 'pipe' });
  git('init');
  writeFileSync(join(source, 'eslint.config.js'), 'export default [];\n');
  git('add', '.');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Fixture');
  const snapshot = join(temp, 'review.json');
  const result = join(temp, 'result.json');
  const output = join(temp, 'output');
  writeFileSync(snapshot, JSON.stringify({ threads: [] }));
  writeFileSync(result, JSON.stringify({ summary: 'Blocked', addressedThreadIds: [], remainingIssues: ['Config requires maintainer changes'] }));
  const script = resolve('.github/scripts/greploop-patch.mjs');
  for (const changed of [false, true]) {
    if (changed) writeFileSync(join(source, 'eslint.config.js'), 'export default [{}];\n');
    const artifact = join(temp, changed ? 'forbidden' : 'empty');
    exec(process.execPath, [script, 'export', source, git('rev-parse', 'HEAD').trim(), snapshot, result, artifact], { env: { GITHUB_OUTPUT: output } });
    const report = JSON.parse(readFileSync(join(artifact, 'result.json'), 'utf8'));
    assert.match(report.reason, changed ? /eslint.config.js/ : /no source changes/);
    assert.throws(() => readFileSync(join(artifact, 'fix.patch')), /ENOENT/);
  }
  assert.equal(readFileSync(output, 'utf8'), 'patch=false\npatch=false\n');
});


test('decision notices are updated and deduplicated without modifying attempt reservations', async () => {
  const comments = [{ id: 1, user: { login: 'github-actions[bot]', type: 'Bot' }, body: `<!-- traveled-greploop-attempt:${sha} --> Running` }];
  let updates = 0;
  const github = { paginate: async () => comments, rest: { issues: { listComments() {},
    createComment: async ({ body }) => comments.push({ id: 2, user: { login: 'github-actions[bot]', type: 'Bot' }, body }),
    updateComment: async ({ comment_id, body }) => { assert.equal(comment_id, 2); updates++; comments[1].body = body; },
  } } };
  const context = { repo: { owner: 'owner', repo: 'repo' } };
  const core = { summary: { addRaw() { return this; }, async write() {} } };
  await notice({ github, context, core }, 9, 'No new run: already reserved.');
  await notice({ github, context, core }, 9, 'No new run: already reserved.');
  assert.equal(comments.length, 2);
  assert.equal(updates, 0);
  await notice({ github, context, core }, 9, 'Not running: review complete.');
  assert.equal(updates, 1);
  assert.match(comments[0].body, /Running$/);
  assert.deepEqual(attemptsFrom(comments), [sha]);
});


test('write-capable reporting job uses only immutable action revisions', () => {
  const workflow = readFileSync('.github/workflows/greploop.yml', 'utf8');
  const report = workflow.match(/^ {2}report:\n([\s\S]*?)(?=^ {2}[a-z][\w-]*:\n|(?![\s\S]))/m)?.[1];
  assert.ok(report, 'Reporting job must be present');
  const actions = [...report.matchAll(/uses:\s*(\S+)/g)].map((match) => match[1]);
  assert.ok(actions.length > 0);
  for (const action of actions) assert.match(action, /^[\w-]+\/[\w-]+@[a-f0-9]{40}$/, `${action} must be pinned`);
});


test('repository fixtures are safe inside a Git hook', () => {
  const parent = mkdtempSync(join(tmpdir(), 'traveled-greploop-hook-'));
  const git = (...args) => exec('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: parent, encoding: 'utf8', stdio: 'pipe' });
  git('init');
  writeFileSync(join(parent, 'sentinel.txt'), 'original\n');
  git('add', 'sentinel.txt');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Fixture');
  writeFileSync(join(parent, 'sentinel.txt'), 'staged change\n');
  git('add', 'sentinel.txt');
  const config = readFileSync(join(parent, '.git/config'));
  const index = readFileSync(join(parent, '.git/index'));
  const head = git('rev-parse', 'HEAD');
  const output = join(parent, 'workflow-output');
  writeFileSync(output, 'untouched\n');
  // Deliberately pass hook variables only to this child test runner. Its fixture
  // helpers must clear them before invoking Git or the patch-export process.
  const env = { ...process.env, GIT_DIR: join(parent, '.git'), GIT_WORK_TREE: parent, GIT_INDEX_FILE: join(parent, '.git/index'), GITHUB_OUTPUT: output };
  delete env.NODE_TEST_CONTEXT;
  const results = execFileSync(process.execPath, ['--test', '--test-reporter=tap', '--test-name-pattern=^(patch exports|no patch and forbidden)', resolve('.github/scripts/greploop.test.mjs')], {
    stdio: 'pipe', encoding: 'utf8', env,
  });
  assert.match(results, /ok \d+ - patch exports and applies/);
  assert.match(results, /ok \d+ - no patch and forbidden configuration/);
  assert.deepEqual(readFileSync(join(parent, '.git/config')), config);
  assert.deepEqual(readFileSync(join(parent, '.git/index')), index);
  assert.equal(git('rev-parse', 'HEAD'), head);
  assert.equal(readFileSync(join(parent, 'sentinel.txt'), 'utf8'), 'staged change\n');
  assert.equal(readFileSync(output, 'utf8'), 'untouched\n');
});
