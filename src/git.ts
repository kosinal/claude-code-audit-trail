import { spawnSync } from "node:child_process";
import * as path from "node:path";

export interface GitCommit {
  hash: string;
  subject: string;
  author: string;
  date: string;
}

export interface GitInfo {
  branch: string | null;
  last_commit: GitCommit | null;
  worktree_name: string;
}

const GIT_TIMEOUT_MS = 1500;

function runGit(cwd: string, args: string[]): { stdout: string; ok: boolean } {
  try {
    const res = spawnSync("git", ["-C", cwd, ...args], {
      timeout: GIT_TIMEOUT_MS,
      encoding: "utf-8",
      shell: false,
      windowsHide: true,
    });
    if (res.status !== 0 || res.error) {
      return { stdout: "", ok: false };
    }
    return { stdout: res.stdout ?? "", ok: true };
  } catch {
    return { stdout: "", ok: false };
  }
}

/**
 * Best-effort git context for the given directory. Returns `null` if `cwd`
 * is not inside a git work tree or `git` is unavailable. Never throws.
 */
export function collectGitInfo(cwd: string): GitInfo | null {
  const inside = runGit(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok || inside.stdout.trim() !== "true") return null;

  const branchRes = runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const branch = branchRes.ok ? branchRes.stdout.trim() || null : null;

  const SEP = "\x1f";
  const logRes = runGit(cwd, ["log", "-1", `--pretty=format:%H${SEP}%s${SEP}%an${SEP}%aI`]);
  let lastCommit: GitCommit | null = null;
  if (logRes.ok && logRes.stdout) {
    const parts = logRes.stdout.split(SEP);
    if (parts.length >= 4) {
      lastCommit = {
        hash: (parts[0] ?? "").trim(),
        subject: (parts[1] ?? "").trim(),
        author: (parts[2] ?? "").trim(),
        date: (parts[3] ?? "").trim(),
      };
    }
  }

  const worktreeName = resolveWorktreeName(cwd);

  return { branch, last_commit: lastCommit, worktree_name: worktreeName };
}

function resolveWorktreeName(cwd: string): string {
  const gitDir = runGit(cwd, ["rev-parse", "--git-dir"]);
  const commonDir = runGit(cwd, ["rev-parse", "--git-common-dir"]);
  if (!gitDir.ok || !commonDir.ok) return "";
  const a = path.resolve(cwd, gitDir.stdout.trim());
  const b = path.resolve(cwd, commonDir.stdout.trim());
  if (a === b) return "";

  const top = runGit(cwd, ["rev-parse", "--show-toplevel"]);
  if (!top.ok) return "";
  return path.basename(top.stdout.trim());
}
