import * as assert from "node:assert/strict";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { collectGitInfo } from "./git.ts";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cc-audit-git-"));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function gitInit(dir: string): void {
  execSync(`git init -q -b main "${dir}"`, { stdio: "ignore" });
  execSync(`git -C "${dir}" config user.email "test@example.com"`);
  execSync(`git -C "${dir}" config user.name "Test"`);
  execSync(`git -C "${dir}" config commit.gpgsign false`);
}

describe("collectGitInfo", () => {
  it("returns null outside a repo", () => {
    assert.equal(collectGitInfo(tmpRoot), null);
  });

  it("returns branch and last commit inside a repo", () => {
    const repo = path.join(tmpRoot, "repo");
    fs.mkdirSync(repo);
    gitInit(repo);
    fs.writeFileSync(path.join(repo, "README"), "hello");
    execSync(`git -C "${repo}" add README`);
    execSync(`git -C "${repo}" commit -q -m "initial commit"`);

    const info = collectGitInfo(repo);
    assert.ok(info, "expected git info");
    assert.equal(info.branch, "main");
    assert.ok(info.last_commit, "expected last commit");
    assert.equal(info.last_commit.subject, "initial commit");
    assert.equal(info.last_commit.author, "Test");
    assert.match(info.last_commit.hash, /^[0-9a-f]{40}$/);
    assert.equal(info.worktree_name, "");
  });

  it("populates worktree_name in a linked worktree", () => {
    const repo = path.join(tmpRoot, "repo");
    fs.mkdirSync(repo);
    gitInit(repo);
    fs.writeFileSync(path.join(repo, "README"), "hello");
    execSync(`git -C "${repo}" add README`);
    execSync(`git -C "${repo}" commit -q -m "initial"`);

    const wt = path.join(tmpRoot, "wt-feature");
    execSync(`git -C "${repo}" worktree add -q -b feature-x "${wt}"`);

    const info = collectGitInfo(wt);
    assert.ok(info, "expected git info");
    assert.equal(info.branch, "feature-x");
    assert.equal(info.worktree_name, "wt-feature");
  });
});
