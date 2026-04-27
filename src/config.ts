import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface AuditConfig {
  destDir: string;
  version: string;
}

export const DEFAULT_DEST_DIR = path.join(os.homedir(), ".claude", "audit-trail");

export function getConfigDir(): string {
  return path.join(os.homedir(), ".claude", "audit-trail");
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), "config.json");
}

export function readConfig(): AuditConfig | null {
  try {
    const raw = fs.readFileSync(getConfigPath(), "utf-8");
    const parsed = JSON.parse(raw) as Partial<AuditConfig>;
    if (typeof parsed.destDir !== "string" || !parsed.destDir) return null;
    return {
      destDir: parsed.destDir,
      version: typeof parsed.version === "string" ? parsed.version : "0.0.0",
    };
  } catch {
    return null;
  }
}

export function writeConfig(config: AuditConfig): void {
  const dir = getConfigDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getConfigPath(), `${JSON.stringify(config, null, 2)}\n`);
}

export function archivesDir(destDir: string): string {
  return path.join(destDir, "archives");
}

export function ensureDestLayout(destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true });
  fs.mkdirSync(archivesDir(destDir), { recursive: true });
}
