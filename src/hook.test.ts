import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { processPayload } from "./hook.ts";

let dest: string;

beforeEach(() => {
  dest = fs.mkdtempSync(path.join(os.tmpdir(), "cc-audit-dest-"));
});

afterEach(() => {
  fs.rmSync(dest, { recursive: true, force: true });
});

describe("processPayload", () => {
  it("writes a JSON entry with the expected shape", () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-audit-proj-"));
    try {
      const written = processPayload(
        JSON.stringify({
          session_id: "session-xyz",
          cwd: projectDir,
          prompt: "hello world",
          hook_event_name: "UserPromptSubmit",
        }),
        dest,
      );
      assert.ok(written, "expected a path back");
      assert.ok(fs.existsSync(written), "entry file should exist");

      const entry = JSON.parse(fs.readFileSync(written, "utf-8")) as Record<string, unknown>;
      assert.equal(entry.session_name, "session-xyz");
      assert.equal(entry.message, "hello world");
      assert.equal(entry.directory, path.normalize(projectDir));
      assert.equal(entry.git, null);
      assert.match(String(entry.timestamp), /^\d{4}-\d{2}-\d{2}T/);
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("strips .claude/worktree from the recorded directory", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "cc-audit-parent-"));
    const wt = path.join(parent, ".claude", "worktree", "feature");
    fs.mkdirSync(wt, { recursive: true });
    try {
      const written = processPayload(
        JSON.stringify({ session_id: "wt", cwd: wt, prompt: "in worktree" }),
        dest,
      );
      assert.ok(written);
      const entry = JSON.parse(fs.readFileSync(written, "utf-8")) as Record<string, unknown>;
      assert.equal(entry.directory, path.normalize(parent));
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  it("does not collide on rapid concurrent writes", () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-audit-conc-"));
    try {
      const N = 25;
      const written = new Set<string>();
      for (let i = 0; i < N; i++) {
        const p = processPayload(
          JSON.stringify({ session_id: "same", cwd: projectDir, prompt: `m${i}` }),
          dest,
        );
        assert.ok(p);
        written.add(p);
      }
      assert.equal(written.size, N, "every write should produce a unique filename");
      const files = fs.readdirSync(dest).filter((f) => f.endsWith(".json"));
      assert.equal(files.length, N);
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("tolerates empty stdin and writes a stub entry", () => {
    const written = processPayload("", dest);
    assert.ok(written);
    const entry = JSON.parse(fs.readFileSync(written, "utf-8")) as Record<string, unknown>;
    assert.equal(entry.session_name, "unknown");
    assert.equal(entry.message, "");
  });

  it("tolerates malformed JSON input", () => {
    const written = processPayload("not-json{", dest);
    assert.ok(written);
    const entry = JSON.parse(fs.readFileSync(written, "utf-8")) as Record<string, unknown>;
    assert.equal(entry.session_name, "unknown");
  });
});
