# Traveled agent guide

## Project context

Traveled is a Vite + React + TypeScript application styled with Tailwind CSS. It uses locally owned shadcn/ui-style components, MapLibre GL JS, and Supabase (Auth, Postgres, Storage, and Row Level Security).

## Working conventions

- Prefer TypeScript throughout; keep components focused, typed, and reusable.
- Reuse the project's existing UI primitives and Tailwind patterns before adding new components or dependencies.
- Build accessible UI: semantic HTML first, keyboard-operable controls, visible focus states, and labels or accessible names for interactive elements.
- Keep client-side Supabase access behind the existing client boundary. Preserve RLS policies; make database or Storage schema changes through new migrations rather than editing applied migrations.
- Keep credentials in `.env` only. Never read, print, commit, or modify `.env` files or other secret-bearing files.

## Local plans

- Save finalized implementation plans in the repository's ignored `plans/` folder using `YYYY-MM-DD-short-topic.md` filenames.
- Include enough context, decisions, implementation steps, and validation criteria for another agent to carry out the plan without the original conversation. Link the saved file in the response.
- Update the same file when revising a plan for the same task; use a new file for a separate task. Saving a plan does not authorize implementation.
- Follow active mode restrictions: if Plan Mode prohibits writing files, present the plan in chat and save it when file writes are permitted again.

## Commands and validation

The current scripts are `pnpm dev`, `pnpm build`, `pnpm lint`, and `pnpm preview`. There is no test script or Python/virtual-environment tooling in this repository yet; do not claim that either exists.

For relevant code changes, run `pnpm lint` and `pnpm build`. Report commands that cannot be run and why.

## Local change notes

- Before an authorized commit, prepare root-level `NOTES.draft.json` with a descriptive `title`, a `changes` array, a `rationale` string explaining the chosen approach and reasons, a `tradeoffs` array covering relevant alternatives, and a `validation` array of actual results. Use nonempty strings; explicitly state when no relevant alternatives or validation apply.
- Describe only staged work. Record concise decision explanations, not conversation transcripts or secrets. The independent reviewer does not receive the draft.
- After completing the draft, run `node scripts/local-notes.mjs bind` to bind it to the current staged tree and parent commit. Review and refresh the content and rerun the helper whenever staged changes change.
- The pre-commit hook reviews first, then publishes valid drafts to ignored `NOTES.md`. Missing, malformed, stale, or unsavable notes block the commit. Keep the draft for retries. Entries describe review-approved changes, which may not become commits if a later step fails or is canceled.

## Repository safety

- Preserve unrelated user changes and keep edits scoped to the requested work.
- Do not create commits, push branches, or change remotes unless the user explicitly asks.
- Do not use destructive history operations such as `git reset --hard` or force pushes.
- Do not delete files or directories without explicit user approval.
