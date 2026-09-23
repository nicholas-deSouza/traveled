# Traveled agent guide

## Project context

Traveled is a Vite + React + TypeScript application styled with Tailwind CSS. It uses locally owned shadcn/ui-style components, MapLibre GL JS, and Supabase (Auth, Postgres, Storage, and Row Level Security).

## Working conventions

- Prefer TypeScript throughout; keep components focused, typed, and reusable.
- Reuse the project's existing UI primitives and Tailwind patterns before adding new components or dependencies.
- Build accessible UI: semantic HTML first, keyboard-operable controls, visible focus states, and labels or accessible names for interactive elements.
- Keep client-side Supabase access behind the existing client boundary. Preserve RLS policies; make database or Storage schema changes through new migrations rather than editing applied migrations.
- Keep credentials in `.env` only. Never read, print, commit, or modify `.env` files or other secret-bearing files.

## Component tests

- Every component file, including pages and `App.tsx`, must have an adjacent `<name>.test.tsx` file. The `main.tsx` entry point and `src/test/` helpers are excluded.
- Add meaningful behavior tests with Vitest and React Testing Library in the same change as a new component. Use accessible queries and user interactions; cover relevant loading, error, and disabled states.
- Mock Supabase at the existing client or data boundary and mock MapLibre; tests must not need credentials, live services, or `.env` files.
- `pnpm test` checks component/test pairing and runs all local component and Node script tests. The pre-commit hook runs this command and blocks on failures.

## Commands and validation

The current scripts include `pnpm dev`, `pnpm build`, `pnpm lint`, `pnpm preview`, `pnpm test` (full local suite), and `pnpm test:watch` (component watch mode).

For relevant code changes, run `pnpm test`, `pnpm lint`, and `pnpm build`. Report commands that cannot be run and why.

## Repository safety

- Preserve unrelated user changes and keep edits scoped to the requested work.
- Do not create commits, push branches, or change remotes unless the user explicitly asks.
- Do not use destructive history operations such as `git reset --hard` or force pushes.
- Do not delete files or directories without explicit user approval.
