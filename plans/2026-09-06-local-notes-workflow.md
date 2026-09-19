# Local notes gated by pre-commit review

Status: Implemented on 2026-09-06. The existing review script calls the notes publisher directly after approval, passing the reviewed tree and captured parent. No working-repository commit was created.

Create a local `NOTES.md` with a short project overview and an accumulating history of approved changes. The working agent supplies the actual decision rationale; the existing reviewer remains independent.

## Implementation

- Ignore root-level `NOTES.md` and `NOTES.draft.json` in Git.
- Initialize `NOTES.md` with a factual overview from the repository, without inventing historical reasoning.
- Add guidance to `AGENTS.md`: prepare the draft before committing, covering the change summary, chosen approach and reasons, relevant alternatives, and validation results. Record concise decision explanations, not conversation transcripts.
- Provide a small Node helper to bind the completed draft to the current staged tree. Refresh it whenever staged changes change; unstaged work must not appear in the entry.
- Extend the existing Git pre-commit flow: run the review first, then validate and publish the draft. Pass the reviewed tree identifier directly to the notes step and verify that the index still matches.
- Block the commit if the draft is missing, malformed, stale, or cannot be saved. Failed reviews and empty staged diffs leave notes untouched.
- Save notes atomically, preserving existing content. Identify entries by parent commit and staged tree so retries do not duplicate entries. Retain the draft for retry; an old draft cannot authorize different changes.
- Document the workflow in the existing hook README. No new dependencies or application API changes.

## Entry format

Each entry contains a date, descriptive title, high-level changes, decision rationale, relevant tradeoffs, validation results, and the staged snapshot identifier. Keep entries concise and newest first beneath the overview.

Label entries as **review-approved changes**: a pre-commit hook runs before Git creates the commit, so a later cancellation can leave an approved entry without a completed commit.

## Validation

- Use temporary Git fixtures and a stub reviewer to verify review failure, successful publication, missing or stale drafts, index changes, write failures, empty diffs, and duplicate-free retries.
- Confirm both local notes files are ignored and existing handwritten content is preserved.
- Run `pnpm lint` and `pnpm build`; report any failures.
- Do not create commits in the working repository.

## Defaults

- Missing notes block commits, as selected.
- Start with a project overview and document changes going forward.
- Hooks and instructions are tracked; notes and drafts stay local.
- Git's existing `--no-verify` bypass also bypasses notes publication.

## Repository context

- `.githooks/pre-commit` currently delegates to `scripts/review-staged.mjs`; the clone already uses `.githooks` as `core.hooksPath`.
- The reviewer runs a fresh ephemeral Codex session on the staged diff and blocks on findings, invalid reports, CLI failures, or index changes. It has no conversation context.
- Preserve that independent review boundary. The draft carries the working agent's decision rationale.
- Follow `AGENTS.md`, including its secret-file restrictions and prohibition on creating commits without explicit authorization.
