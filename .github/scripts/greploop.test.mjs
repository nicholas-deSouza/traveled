import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { allowedPath, validateResult } from './greploop-patch.mjs';
import { attemptsFrom, decision, eligible, scoreFrom, selectReview, assertCurrent, intake } from './greploop.mjs';

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
    assert.match(readFileSync('prompt.md', 'utf8'), /Confidence Score/);
    delete outputs.run;
    await intake({ github, context, core });
    assert.equal(outputs.run, undefined);
    assert.equal(comments.length, 2);
  } finally {
    process.chdir(previous);
  }
});

test('patch exports and applies in a fresh checkout; deleted files are rejected', () => {
  // Hooks export repository-local Git variables. Do not let temporary repos
  // inherit the committing repository's worktree, object directory, or index.
  const env = { ...process.env };
  for (const key of execFileSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8' }).trim().split(/\s+/)) {
    delete env[key];
  }
  const exec = (command, args, options = {}) => execFileSync(command, args, { ...options, env });
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
