import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ensureDestLayout, writeConfig } from "./config.ts";
import { installSkill, uninstallSkill } from "./skill.ts";

export const HOOK_MARKER = "__claude_code_audit_trail__";
const HOOK_EVENT = "UserPromptSubmit";
const HOOK_COMMAND = "npx -y @kosinal/claude-code-audit-trail hook";

interface HookEntry {
  type: string;
  command: string;
  async?: boolean;
  statusMessage?: string;
  [key: string]: unknown;
}

interface MatcherGroup {
  matcher?: string;
  hooks: HookEntry[];
  [key: string]: unknown;
}

interface Settings {
  hooks?: Record<string, MatcherGroup[]>;
  [key: string]: unknown;
}

function settingsPath(): string {
  return path.join(os.homedir(), ".claude", "settings.json");
}

function readSettings(): Settings {
  const p = settingsPath();
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as Settings;
  } catch (err) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    // Invalid JSON — back up and start fresh, matching dashboard behavior.
    try {
      fs.copyFileSync(p, `${p}.bak`);
      process.stderr.write(`Warning: invalid settings.json backed up to ${p}.bak\n`);
    } catch {
      /* ignore */
    }
    return {};
  }
}

function writeSettings(settings: Settings): void {
  const p = settingsPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(settings, null, 2)}\n`);
}

function backupSettingsOnce(): void {
  const p = settingsPath();
  const backup = p.replace(/\.json$/, ".pre-audit-trail.json");
  if (fs.existsSync(p) && !fs.existsSync(backup)) {
    try {
      fs.copyFileSync(p, backup);
    } catch {
      /* ignore */
    }
  }
}

function stripExistingMarker(settings: Settings): void {
  if (!settings.hooks) return;
  for (const event of Object.keys(settings.hooks)) {
    const groups = settings.hooks[event];
    if (!groups) continue;
    const filtered: MatcherGroup[] = [];
    for (const group of groups) {
      const kept = group.hooks.filter((h) => h.statusMessage !== HOOK_MARKER);
      if (kept.length > 0) filtered.push({ ...group, hooks: kept });
    }
    if (filtered.length > 0) settings.hooks[event] = filtered;
    else delete settings.hooks[event];
  }
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
}

export interface InstallOptions {
  destDir: string;
  packageVersion: string;
}

export interface InstallResult {
  destDir: string;
  settingsPath: string;
  skillPath: string;
  skillInstalled: boolean;
  skillError?: string;
}

export function install(opts: InstallOptions): InstallResult {
  const destDir = path.resolve(opts.destDir);
  ensureDestLayout(destDir);
  writeConfig({ destDir, version: opts.packageVersion });

  backupSettingsOnce();
  const settings = readSettings();
  stripExistingMarker(settings);

  if (!settings.hooks) settings.hooks = {};
  if (!settings.hooks[HOOK_EVENT]) settings.hooks[HOOK_EVENT] = [];

  settings.hooks[HOOK_EVENT].push({
    hooks: [
      {
        type: "command",
        command: HOOK_COMMAND,
        async: true,
        statusMessage: HOOK_MARKER,
      },
    ],
  });

  writeSettings(settings);
  const skill = installSkill();
  return {
    destDir,
    settingsPath: settingsPath(),
    skillPath: skill.path,
    skillInstalled: skill.ok,
    skillError: skill.error,
  };
}

export interface UninstallResult {
  hookRemoved: boolean;
  skillRemoved: boolean;
}

export function uninstall(): UninstallResult {
  const settings = readSettings();
  const before = JSON.stringify(settings);
  stripExistingMarker(settings);
  const after = JSON.stringify(settings);
  const hookRemoved = before !== after;
  if (hookRemoved) writeSettings(settings);
  const { removed: skillRemoved } = uninstallSkill();
  return { hookRemoved, skillRemoved };
}
