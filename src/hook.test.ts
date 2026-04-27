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
      assert.equal(entry.event_type, "user_prompt");
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

  it("records AskUserQuestion answers as a tool_answer entry", () => {
    const written = processPayload(
      JSON.stringify({
        hook_event_name: "PostToolUse",
        session_id: "session-q",
        tool_name: "AskUserQuestion",
        tool_input: {
          questions: [{ question: "Which framework?" }],
          answers: { "Which framework?": "React" },
        },
        tool_response: {},
      }),
      dest,
    );
    assert.ok(written, "expected an entry to be written");
    const entry = JSON.parse(fs.readFileSync(written, "utf-8")) as Record<string, unknown>;
    assert.equal(entry.event_type, "tool_answer");
    assert.equal(entry.tool_name, "AskUserQuestion");
    assert.equal(entry.message, JSON.stringify({ "Which framework?": "React" }));
  });

  it("records ExitPlanMode rejection feedback as a tool_answer entry", () => {
    const written = processPayload(
      JSON.stringify({
        hook_event_name: "PostToolUse",
        session_id: "session-r",
        tool_name: "ExitPlanMode",
        tool_input: { plan: "step 1\nstep 2" },
        tool_response: { user_response: "split this into smaller PRs" },
      }),
      dest,
    );
    assert.ok(written, "expected an entry to be written");
    const entry = JSON.parse(fs.readFileSync(written, "utf-8")) as Record<string, unknown>;
    assert.equal(entry.event_type, "tool_answer");
    assert.equal(entry.tool_name, "ExitPlanMode");
    assert.equal(entry.message, "split this into smaller PRs");
  });

  it("does not record ExitPlanMode without user-typed feedback", () => {
    const written = processPayload(
      JSON.stringify({
        hook_event_name: "PostToolUse",
        session_id: "session-a",
        tool_name: "ExitPlanMode",
        tool_input: { plan: "the plan" },
        tool_response: {},
      }),
      dest,
    );
    assert.equal(written, null);
    assert.equal(fs.readdirSync(dest).filter((f) => f.endsWith(".json")).length, 0);
  });

  it("does not record AskUserQuestion when answers are missing or empty", () => {
    const writtenMissing = processPayload(
      JSON.stringify({
        hook_event_name: "PostToolUse",
        tool_name: "AskUserQuestion",
        tool_input: { questions: [] },
        tool_response: {},
      }),
      dest,
    );
    assert.equal(writtenMissing, null);

    const writtenEmpty = processPayload(
      JSON.stringify({
        hook_event_name: "PostToolUse",
        tool_name: "AskUserQuestion",
        tool_input: { answers: {} },
        tool_response: {},
      }),
      dest,
    );
    assert.equal(writtenEmpty, null);
    assert.equal(fs.readdirSync(dest).filter((f) => f.endsWith(".json")).length, 0);
  });

  it("ignores PostToolUse for untracked tools", () => {
    const written = processPayload(
      JSON.stringify({
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_input: { command: "ls" },
        tool_response: { stdout: "file" },
      }),
      dest,
    );
    assert.equal(written, null);
    assert.equal(fs.readdirSync(dest).filter((f) => f.endsWith(".json")).length, 0);
  });
});
