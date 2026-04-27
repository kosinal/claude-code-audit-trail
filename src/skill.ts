import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_NAME = "audit-log-compact";

function skillTargetDir(): string {
  return path.join(os.homedir(), ".claude", "skills", SKILL_NAME);
}

/**
 * Resolves the bundled skill source. When running from `dist/bin.js` (npm
 * install), the skill ships at `<pkg>/skills/audit-log-compact/SKILL.md` —
 * one level up from the dist directory. Falls back to repo layout for `npm
 * link` / dev runs.
 */
function findBundledSkill(): string | null {
  let here: string;
  try {
    here = path.dirname(fileURLToPath(import.meta.url));
  } catch {
    here = process.cwd();
  }

  const candidates = [
    path.resolve(here, "..", "skills", SKILL_NAME, "SKILL.md"),
    path.resolve(here, "..", "..", "skills", SKILL_NAME, "SKILL.md"),
    path.resolve(process.cwd(), "skills", SKILL_NAME, "SKILL.md"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

export function installSkill(): { ok: boolean; path: string; error?: string } {
  const target = path.join(skillTargetDir(), "SKILL.md");
  const source = findBundledSkill();
  if (!source) {
    return { ok: false, path: target, error: "Bundled skill file not found" };
  }
  fs.mkdirSync(skillTargetDir(), { recursive: true });
  fs.copyFileSync(source, target);
  return { ok: true, path: target };
}

export function uninstallSkill(): { removed: boolean; path: string } {
  const dir = skillTargetDir();
  if (!fs.existsSync(dir)) return { removed: false, path: dir };
  fs.rmSync(dir, { recursive: true, force: true });
  return { removed: true, path: dir };
}
