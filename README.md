# claude-code-audit-trail

Persist every prompt you send to Claude Code as a JSON audit-trail entry, with session, working directory, and git context. Cross-platform (macOS, Linux, Windows) — runs through `npx`.

## Install

```bash
npx @kosinal/claude-code-audit-trail install
```

The installer:

- Prompts for a destination folder (default: `~/.claude/audit-trail/`).
- Creates the folder and an `archives/` subfolder.
- Adds a `UserPromptSubmit` hook to `~/.claude/settings.json`.
- Drops an `audit-log-compact` skill into `~/.claude/skills/`.

You can pass a destination non-interactively:

```bash
npx @kosinal/claude-code-audit-trail install --dest /path/to/audit
```

## What gets recorded

Each prompt produces one file in the destination folder:

```
{destDir}/2026-04-27T12-34-56-789Z__<session-id>.json
```

with this body:

```json
{
  "timestamp": "2026-04-27T12:34:56.789Z",
  "session_name": "abc123…",
  "directory": "/Users/me/projects/foo",
  "git": {
    "branch": "main",
    "last_commit": {
      "hash": "…",
      "subject": "…",
      "author": "…",
      "date": "…"
    },
    "worktree_name": "feature-x"
  },
  "message": "the user prompt"
}
```

If the working directory contains `.claude/worktree` (or `.claude/worktrees`), the path before that segment is recorded so worktree sessions trace back to the parent project. If git isn't available, `git` is `null`.

One file per event lets parallel Claude Code sessions write without locking.

## Compacting

Old entries can be rolled into a zip archive:

```bash
npx @kosinal/claude-code-audit-trail compact
```

Produces `{destDir}/archives/{firstISO}_{lastISO}.zip` and removes the originals on success. The bundled `audit-log-compact` skill runs the same command from inside Claude Code.

## Uninstall

```bash
npx @kosinal/claude-code-audit-trail uninstall
```

Removes the hook and the skill. Audit data and archives are preserved.

## Requirements

- Node.js 20 or newer.
- `git` on `PATH` for git context (optional — entries still record without it).

## License

GPL-3.0-only.
