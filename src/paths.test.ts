import * as assert from "node:assert/strict";
import * as path from "node:path";
import { describe, it } from "node:test";
import { buildArchiveFilename, buildEntryFilename, normalizeCwd } from "./paths.ts";

describe("normalizeCwd", () => {
  it("returns plain path unchanged (normalized)", () => {
    const input = "/Users/me/projects/foo";
    assert.equal(normalizeCwd(input), path.normalize(input));
  });

  it("strips .claude/worktree suffix", () => {
    assert.equal(
      normalizeCwd("/Users/me/projects/foo/.claude/worktree/feature-x"),
      path.normalize("/Users/me/projects/foo"),
    );
  });

  it("strips .claude/worktrees (plural) suffix", () => {
    assert.equal(
      normalizeCwd("/Users/me/projects/foo/.claude/worktrees/feature-x/sub"),
      path.normalize("/Users/me/projects/foo"),
    );
  });

  it("handles Windows-style backslashes", () => {
    const input = "C:\\Users\\me\\proj\\.claude\\worktree\\feature";
    const result = normalizeCwd(input);
    // Result should match the parent (path.normalize converts forward to platform)
    assert.equal(result, path.normalize("C:/Users/me/proj"));
  });

  it("returns empty when input empty", () => {
    assert.equal(normalizeCwd(""), "");
  });

  it("does not strip if .claude appears without /worktree", () => {
    const input = "/Users/me/.claude/projects/x";
    assert.equal(normalizeCwd(input), path.normalize(input));
  });
});

describe("buildEntryFilename", () => {
  it("replaces colons in timestamp", () => {
    const f = buildEntryFilename("2026-04-27T12:34:56.789Z", "abc", "ab12");
    assert.ok(!f.includes(":"));
    assert.ok(f.startsWith("2026-04-27T12-34-56.789Z__abc__ab12"));
    assert.ok(f.endsWith(".json"));
  });

  it("sanitizes session id", () => {
    const f = buildEntryFilename("2026-04-27T12-34-56.789Z", "abc/def\\xx", "0000");
    assert.ok(!/[\\/]/.test(f));
  });

  it("falls back to 'unknown' on empty session id", () => {
    const f = buildEntryFilename("2026-04-27T12-34-56.789Z", "", "0000");
    assert.ok(f.includes("__unknown__"));
  });
});

describe("buildArchiveFilename", () => {
  it("replaces colons in both timestamps", () => {
    const f = buildArchiveFilename("2026-04-27T12:00:00.000Z", "2026-04-28T12:00:00.000Z");
    assert.ok(!f.includes(":"));
    assert.equal(f, "2026-04-27T12-00-00.000Z_2026-04-28T12-00-00.000Z.zip");
  });
});
