---
name: audit-log-compact
description: Roll up Claude Code audit-trail JSON entries into a dated zip archive. Use when the audit-trail folder has accumulated entries and the user wants to compact, rotate, or archive them.
---

# audit-log-compact

When the user asks to compact, archive, or rotate the Claude Code audit-trail entries, run:

```bash
npx -y @kosinal/claude-code-audit-trail compact
```

Then report back:

- The path to the zip archive that was produced (printed by the command).
- The number of entries that were archived.
- Any per-file delete failures the command surfaced.

If the command prints `No audit entries to compact.`, tell the user there was nothing to do.

If the command exits non-zero, surface the stderr output verbatim — do not retry without user direction.
