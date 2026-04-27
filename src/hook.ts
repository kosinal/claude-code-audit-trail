import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { archivesDir, readConfig } from "./config.ts";
import { collectGitInfo, type GitInfo } from "./git.ts";
import { buildEntryFilename, normalizeCwd } from "./paths.ts";

interface HookPayload {
  session_id?: string;
  cwd?: string;
  prompt?: string;
  hook_event_name?: string;
  transcript_path?: string;
}

export interface AuditEntry {
  timestamp: string;
  session_name: string;
  directory: string;
  git: GitInfo | null;
  message: string;
}

/**
 * Reads a Claude Code hook payload from stdin and writes one audit entry.
 * Best-effort: any failure is logged to stderr and the process exits 0 so
 * the hook never blocks the user's session.
 */
export async function runHook(): Promise<number> {
  try {
    const config = readConfig();
    if (!config) {
      // Not installed — silently no-op; hook fired but user hasn't run install.
      return 0;
    }
    const raw = await readStdin();
    const written = processPayload(raw, config.destDir);
    if (!written) return 0;
    return 0;
  } catch (err) {
    process.stderr.write(`audit-trail hook error: ${formatError(err)}\n`);
    return 0;
  }
}

/**
 * Pure entry point used by tests and the hook command. Returns the absolute
 * path of the written entry, or `null` if there was nothing to write.
 */
export function processPayload(raw: string, destDir: string): string | null {
  const payload = parsePayload(raw);
  const directory = normalizeCwd(payload.cwd ?? process.cwd());
  const entry: AuditEntry = {
    timestamp: new Date().toISOString(),
    session_name: payload.session_id ?? "unknown",
    directory,
    git: collectGitInfo(directory),
    message: payload.prompt ?? "",
  };
  return writeEntry(destDir, entry);
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (process.stdin.isTTY) {
      resolve("");
      return;
    }
    const chunks: Buffer[] = [];
    process.stdin.on("data", (c) => chunks.push(Buffer.from(c)));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    process.stdin.on("error", reject);
  });
}

function parsePayload(raw: string): HookPayload {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as HookPayload) : {};
  } catch {
    return {};
  }
}

function writeEntry(destDir: string, entry: AuditEntry): string {
  fs.mkdirSync(destDir, { recursive: true });
  const filename = buildEntryFilename(
    entry.timestamp,
    entry.session_name,
    randomBytes(2).toString("hex"),
  );
  const finalPath = path.join(destDir, filename);
  if (path.resolve(finalPath).startsWith(path.resolve(archivesDir(destDir)) + path.sep)) {
    throw new Error("refusing to write entry inside archives directory");
  }
  const tmpPath = `${finalPath}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(entry, null, 2)}\n`);
  fs.renameSync(tmpPath, finalPath);
  return finalPath;
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.stack || err.message;
  return String(err);
}
