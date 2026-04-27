import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { HOOK_MARKER, install, uninstall } from "./installer.ts";

let tmpHome: string;
let originalHome: string | undefined;
let originalUserProfile: string | undefined;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "cc-audit-installer-"));
  originalHome = process.env.HOME;
  originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

interface Settings {
  hooks?: Record<string, Array<{ matcher?: string; hooks: Array<Record<string, unknown>> }>>;
}

function readSettings(): Settings {
  const p = path.join(tmpHome, ".claude", "settings.json");
  return JSON.parse(fs.readFileSync(p, "utf-8")) as Settings;
}

describe("install", () => {
  it("creates dest folders, config, and adds the marked hook", () => {
    const dest = path.join(tmpHome, "audit");
    const result = install({ destDir: dest, packageVersion: "1.2.3" });

    assert.equal(result.destDir, dest);
    assert.ok(fs.existsSync(dest));
    assert.ok(fs.existsSync(path.join(dest, "archives")));

    const config = JSON.parse(
      fs.readFileSync(path.join(tmpHome, ".claude", "audit-trail", "config.json"), "utf-8"),
    ) as { destDir: string; version: string };
    assert.equal(config.destDir, dest);
    assert.equal(config.version, "1.2.3");

    const settings = readSettings();
    const submitHooks = settings.hooks?.UserPromptSubmit ?? [];
    assert.equal(submitHooks.length, 1);
    const hook = submitHooks[0]?.hooks[0];
    assert.ok(hook);
    assert.equal(hook.statusMessage, HOOK_MARKER);
    assert.equal(hook.type, "command");
    assert.match(String(hook.command), /audit-trail hook/);

    const postToolHooks = settings.hooks?.PostToolUse ?? [];
    assert.equal(postToolHooks.length, 1);
    assert.equal(postToolHooks[0]?.matcher, "AskUserQuestion|ExitPlanMode");
    const postHook = postToolHooks[0]?.hooks[0];
    assert.ok(postHook);
    assert.equal(postHook.statusMessage, HOOK_MARKER);
    assert.match(String(postHook.command), /audit-trail hook/);
  });

  it("preserves existing unrelated hooks", () => {
    fs.mkdirSync(path.join(tmpHome, ".claude"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpHome, ".claude", "settings.json"),
      JSON.stringify({
        hooks: {
          UserPromptSubmit: [
            { hooks: [{ type: "command", command: "echo other", statusMessage: "other-tool" }] },
          ],
        },
      }),
    );

    install({ destDir: path.join(tmpHome, "audit"), packageVersion: "0.0.0" });
    const settings = readSettings();
    const groups = settings.hooks?.UserPromptSubmit ?? [];
    assert.equal(groups.length, 2);
    const all = groups.flatMap((g) => g.hooks);
    assert.ok(all.some((h) => h.statusMessage === "other-tool"));
    assert.ok(all.some((h) => h.statusMessage === HOOK_MARKER));
  });

  it("is idempotent (no duplicates on reinstall)", () => {
    const dest = path.join(tmpHome, "audit");
    install({ destDir: dest, packageVersion: "1.0.0" });
    install({ destDir: dest, packageVersion: "1.0.1" });

    const settings = readSettings();
    for (const event of ["UserPromptSubmit", "PostToolUse"]) {
      const all = (settings.hooks?.[event] ?? []).flatMap((g) => g.hooks);
      const ours = all.filter((h) => h.statusMessage === HOOK_MARKER);
      assert.equal(ours.length, 1, `expected exactly one marked hook under ${event}`);
    }
  });
});

describe("uninstall", () => {
  it("removes the marked hook and reports it", () => {
    install({ destDir: path.join(tmpHome, "audit"), packageVersion: "1.0.0" });
    const r = uninstall();
    assert.equal(r.hookRemoved, true);

    const settings = readSettings();
    for (const event of ["UserPromptSubmit", "PostToolUse"]) {
      const all = (settings.hooks?.[event] ?? []).flatMap((g) => g.hooks);
      assert.equal(all.filter((h) => h.statusMessage === HOOK_MARKER).length, 0);
    }
  });

  it("preserves the audit data folder", () => {
    const dest = path.join(tmpHome, "audit");
    install({ destDir: dest, packageVersion: "1.0.0" });
    fs.writeFileSync(path.join(dest, "entry.json"), "{}");
    uninstall();
    assert.ok(fs.existsSync(path.join(dest, "entry.json")));
  });

  it("reports hookRemoved=false when no hook is installed", () => {
    fs.mkdirSync(path.join(tmpHome, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(tmpHome, ".claude", "settings.json"), "{}");
    const r = uninstall();
    assert.equal(r.hookRemoved, false);
  });
});
