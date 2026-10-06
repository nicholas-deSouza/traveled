# Pre-commit tests

Enable for a new clone with `git config --local core.hooksPath .githooks`.
Install app dependencies with `pnpm install` first. Node.js 24 or newer, npm,
and pnpm must be on PATH.

Every commit first checks the classifier's installed dependencies against its
lockfile and verifies that Sharp's native image support loads. A working install
is reused without contacting the registry. Missing, outdated, or broken installs
are repaired with `npm ci --prefix infrastructure/photo-classifier --include=optional`.
Repairs can require network access; installation failures block the commit.
The hook then runs `pnpm test` from the repository root. This checks that each
component has an adjacent `.test.tsx` file, runs all Vitest tests once, and runs
all Node script and classifier tests. Any failure blocks the commit. Tests run against the
working tree, including unstaged edits; stage the tested changes before committing.

The hook does not run an agent review. `scripts/review-staged.mjs` remains
available for optional manual reviews. Git's `--no-verify` bypasses the hook.

Database policy tests require a disposable PostgreSQL database and remain a
separate integration check; see README.md. They are not run by this local hook.
