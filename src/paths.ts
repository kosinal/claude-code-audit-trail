import * as path from "node:path";

const WORKTREE_SEGMENTS = ["/.claude/worktree/", "/.claude/worktrees/"];

/**
 * Returns the path the audit entry should record as the project directory.
 * If `cwd` is inside a `.claude/worktree[s]/...` subtree, returns the path
 * before that segment so all worktrees trace back to the parent project.
 */
export function normalizeCwd(cwd: string): string {
  if (!cwd) return cwd;
  const forward = cwd.replace(/\\/g, "/");
  for (const seg of WORKTREE_SEGMENTS) {
    const idx = forward.indexOf(seg);
    if (idx >= 0) {
      const head = forward.slice(0, idx);
      return path.normalize(head);
    }
  }
  return path.normalize(cwd);
}

/**
 * Builds the audit-entry filename. Replaces `:` with `-` so it's valid on
 * Windows. Adds a 4-char random suffix so concurrent writes within the same
 * millisecond do not collide.
 */
export function buildEntryFilename(
  timestampIso: string,
  sessionId: string,
  randomSuffix: string,
): string {
  const safeTs = timestampIso.replace(/:/g, "-");
  const safeSession = sanitizeForFilename(sessionId || "unknown");
  return `${safeTs}__${safeSession}__${randomSuffix}.json`;
}

/**
 * Builds the archive filename for the compact command. Both timestamps are
 * sanitized for Windows.
 */
export function buildArchiveFilename(firstIso: string, lastIso: string): string {
  return `${firstIso.replace(/:/g, "-")}_${lastIso.replace(/:/g, "-")}.zip`;
}

export function sanitizeForFilename(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);
}
