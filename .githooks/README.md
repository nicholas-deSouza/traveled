# Pre-commit tests

Enable for a new clone with `git config --local core.hooksPath .githooks`.
Install dependencies with `pnpm install` first. Node.js and pnpm must be on PATH.

Every commit runs `pnpm test` from the repository root. This checks that each
component has an adjacent `.test.tsx` file, runs all Vitest tests once, and runs
all Node script tests. Any failure blocks the commit. Tests run against the
working tree, including unstaged edits; stage the tested changes before committing.

The hook does not run an agent review. `scripts/review-staged.mjs` remains
available for optional manual reviews. Git's `--no-verify` bypasses the hook.

Database policy tests require a disposable PostgreSQL database and remain a
separate integration check; see README.md. They are not run by this local hook.
