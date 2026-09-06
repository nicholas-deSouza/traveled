# Staged change review

Enable for this clone with `git config --local core.hooksPath .githooks`.
The hook requires Node.js and an authenticated Codex CLI with access to
`gpt-5.6-terra` and support for `exec --ephemeral --ignore-user-config`.
It looks for `codex` on PATH, then the CLI bundled with `ChatGPT.app` in
`/Applications` or `~/Applications`. Set `CODEX_BIN` to an executable path to
override discovery (for example, for a custom app installation).

Every `git commit` with staged changes starts a fresh, ephemeral Terra session.
Only the staged diff and a fixed review prompt are supplied; no conversation is
resumed or forked. The reviewer runs from a temporary directory in read-only mode,
with user configuration and exec rules disabled, and is instructed not to use tools.
It does not receive the repository's unstaged files or previous agent explanations.

The commit waits for review (up to five minutes). Findings, CLI failures, malformed
reports, and index changes during review block the commit. An empty index skips
review. Interactive terminals show a spinner and elapsed time; redirected output
shows plain progress messages. A green success line continues the commit; a red
blocked heading displays numbered findings with severity, location, and explanation.
Colors respect `NO_COLOR`; non-interactive and dumb terminals use plain output.
Raw agent output is saved to a temporary diagnostic log instead of printed. Its
path is shown only when review cannot complete. Reports and logs are retained
for inspection and subject to the OS's temporary-file cleanup.
Sensitive filenames such as `.env` and private key files are rejected before diff
contents are read. This filename check is not a general secret scanner.

The review is limited to the provided diff and may miss issues requiring broader
repository context or binary file inspection. Normal Git `--no-verify` bypasses the
hook when explicitly needed. This hook runs on commit, not when files are staged.

## Local notes

After review succeeds, the hook publishes the working agent's decision rationale
to root-level `NOTES.md`. Both it and `NOTES.draft.json` are ignored and remain
local. The independent reviewer never receives the draft. Force-staged notes,
drafts, and recovery files are rejected before diff contents reach the reviewer.
Missing notes, malformed or stale drafts, a changed index or parent, and save
failures block the commit.
Failed reviews and empty staged diffs leave notes untouched.

For a new clone, create `NOTES.md` with a factual project overview and a
`## Review-approved changes` heading. Do not invent historical decisions.
Before an authorized commit, stage the intended changes and write
`NOTES.draft.json`, for example:

```json
{
  "title": "Describe the staged change",
  "changes": ["What changed for users or maintainers"],
  "rationale": "Why this approach was chosen",
  "tradeoffs": ["Relevant alternatives and why they were not chosen"],
  "validation": ["Actual checks run and their results"]
}
```

Run `node scripts/local-notes.mjs bind` after completing the draft. The helper
adds the staged `tree` and `parent` identifiers. If staged work changes, update
the prose to match and bind again. Unstaged work must not appear in the entry;
the helper binds the snapshot but cannot verify the accuracy of the prose.

Publication preserves existing content and prepends entries beneath the history
heading (appending that heading if absent). It saves with an atomic rename and
retains the draft for retries. The parent/tree pair prevents duplicate entries.
Entries describe **review-approved changes**, not completed commits: cancellation
or failure after pre-commit can leave an approved entry. `git commit --no-verify`
bypasses both review and publication. Failed atomic saves may leave a private
`.local-notes-*.tmp` recovery file alongside the notes.

Run the fixture checks with `node --test scripts/local-notes.test.mjs`.
They use temporary repositories and a stub reviewer, never the working index.
