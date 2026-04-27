import * as fs from "node:fs";
import * as path from "node:path";
import AdmZip from "adm-zip";
import { archivesDir, readConfig } from "./config.ts";
import { buildArchiveFilename } from "./paths.ts";

export interface CompactResult {
  archived: number;
  archivePath: string | null;
  message: string;
}

interface EntryRef {
  filePath: string;
  filename: string;
  timestamp: string;
}

/**
 * Zips every `*.json` audit entry in the destination folder (excluding the
 * `archives/` subdir) into a single archive named with the first/last
 * timestamps, then deletes the originals on success.
 */
export function compact(now: () => Date = () => new Date()): CompactResult {
  const config = readConfig();
  if (!config) {
    throw new Error(
      "No audit-trail config found. Run `npx @kosinal/claude-code-audit-trail install` first.",
    );
  }
  const destDir = config.destDir;
  if (!fs.existsSync(destDir)) {
    return { archived: 0, archivePath: null, message: "Destination folder does not exist." };
  }

  const entries = collectEntries(destDir);
  if (entries.length === 0) {
    return { archived: 0, archivePath: null, message: "No audit entries to compact." };
  }

  entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const first = entries[0];
  const last = entries[entries.length - 1];
  if (!first || !last) {
    return { archived: 0, archivePath: null, message: "No audit entries to compact." };
  }
  const archDir = archivesDir(destDir);
  fs.mkdirSync(archDir, { recursive: true });

  const archivePath = uniqueArchivePath(
    archDir,
    buildArchiveFilename(first.timestamp, last.timestamp),
    now,
  );

  const zip = new AdmZip();
  for (const e of entries) {
    zip.addLocalFile(e.filePath);
  }
  zip.writeZip(archivePath);

  let deleted = 0;
  const failures: string[] = [];
  for (const e of entries) {
    try {
      fs.unlinkSync(e.filePath);
      deleted += 1;
    } catch (err) {
      failures.push(`${e.filename}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (failures.length > 0) {
    return {
      archived: deleted,
      archivePath,
      message: `Archived ${entries.length}, deleted ${deleted}. ${failures.length} delete failure(s):\n${failures.join("\n")}`,
    };
  }

  return {
    archived: entries.length,
    archivePath,
    message: `Archived ${entries.length} entries to ${archivePath}.`,
  };
}

function collectEntries(destDir: string): EntryRef[] {
  const out: EntryRef[] = [];
  const archDir = path.resolve(archivesDir(destDir));
  let names: string[];
  try {
    names = fs.readdirSync(destDir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const filePath = path.join(destDir, name);
    if (path.resolve(filePath).startsWith(archDir + path.sep)) continue;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;

    const ts = readEntryTimestamp(filePath) ?? stat.mtime.toISOString();
    out.push({ filePath, filename: name, timestamp: ts });
  }
  return out;
}

function readEntryTimestamp(filePath: string): string | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as { timestamp?: unknown };
    if (typeof parsed.timestamp === "string" && parsed.timestamp.length > 0) {
      return parsed.timestamp;
    }
    return null;
  } catch {
    return null;
  }
}

function uniqueArchivePath(dir: string, baseName: string, now: () => Date): string {
  const initial = path.join(dir, baseName);
  if (!fs.existsSync(initial)) return initial;
  // Collisions are rare (would mean compact runs at the same first/last bounds
  // twice). Append a short suffix from the current time.
  const stamp = now()
    .toISOString()
    .replace(/[^0-9]/g, "");
  const dotIdx = baseName.lastIndexOf(".");
  const stem = dotIdx > 0 ? baseName.slice(0, dotIdx) : baseName;
  const ext = dotIdx > 0 ? baseName.slice(dotIdx) : "";
  return path.join(dir, `${stem}__${stamp}${ext}`);
}
