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
review. Findings and the temporary report path appear in the terminal. Temporary
reports are retained for inspection and subject to the OS's temporary-file cleanup.
Sensitive filenames such as `.env` and private key files are rejected before diff
contents are read. This filename check is not a general secret scanner.

The review is limited to the provided diff and may miss issues requiring broader
repository context or binary file inspection. Normal Git `--no-verify` bypasses the
hook when explicitly needed. This hook runs on commit, not when files are staged.
