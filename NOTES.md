# Traveled local notes

Traveled is a Vite, React, and TypeScript application styled with Tailwind CSS and locally owned shadcn/ui-style components. It includes dashboard, trip detail, group detail, and login pages, a MapLibre travel globe, and a Supabase client for backend integration. Supabase provides Auth, Postgres, Storage, and Row Level Security.

This local history records decisions going forward; it does not reconstruct historical rationale. Entries are **review-approved changes**. Review happens before Git creates a commit, so later cancellation or failure can leave an entry without a completed commit.

## Review-approved changes

<!-- local-notes:7c429e06921bef54cef9580e72cd26bbc0a7dae0:022f68778797c9b55e8a20a36b206e3066a4fa0b -->
### 2026-09-06 — Add local notes gated by independent staged review

**High-level changes**
- Add an ignored local notes workflow with draft binding, atomic publication, and duplicate-free retries.
- Publish notes only after staged review succeeds and the reviewed tree and parent still match.
- Reject force-staged local notes, drafts, and recovery files before reading the review diff.
- Document local plans and notes guidance and add temporary-repository regression checks.

**Decision rationale**
The working agent supplies concise decision rationale while the existing reviewer remains independent. Binding the draft to the staged tree and parent prevents stale drafts from approving different snapshots. Atomic replacement preserves existing notes on publication failures, and rejecting force-staged local files preserves the private review boundary.

**Tradeoffs and alternatives**
- Missing or invalid notes block commits, requiring a completed draft before retrying.
- Entries record review approval rather than commit completion because later commit steps can fail.
- Reject local notes files instead of filtering them from review so private local artifacts cannot accidentally enter commits through this hook.
- Snapshot binding cannot verify the factual accuracy of the draft prose; the working agent must describe only staged work.

**Validation**
- node --test scripts/local-notes.test.mjs: all 14 fixture checks passed, including force-staged local file rejection before reviewer invocation.
- pnpm lint: passed.
- pnpm build: passed with a warning about chunks larger than 500 kB.
- git diff --check: passed.

Staged snapshot: `022f68778797c9b55e8a20a36b206e3066a4fa0b` · Parent: `7c429e06921bef54cef9580e72cd26bbc0a7dae0`


