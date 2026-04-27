import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import AdmZip from "adm-zip";
import { compact } from "./compact.ts";

let tmpHome: string;
let originalHome: string | undefined;
let originalUserProfile: string | undefined;
let dest: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "cc-audit-home-"));
  originalHome = process.env.HOME;
  originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;

  dest = path.join(tmpHome, "audit");
  fs.mkdirSync(dest, { recursive: true });
  fs.mkdirSync(path.join(dest, "archives"), { recursive: true });
  fs.mkdirSync(path.join(tmpHome, ".claude", "audit-trail"), { recursive: true });
  fs.writeFileSync(
    path.join(tmpHome, ".claude", "audit-trail", "config.json"),
    JSON.stringify({ destDir: dest, version: "0.0.0-test" }),
  );
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

function writeEntry(name: string, ts: string, body: Record<string, unknown> = {}): void {
  fs.writeFileSync(
    path.join(dest, name),
    JSON.stringify({
      timestamp: ts,
      session_name: "s",
      directory: "/x",
      git: null,
      message: "m",
      ...body,
    }),
  );
}

describe("compact", () => {
  it("returns a no-op message when there are no entries", () => {
    const r = compact();
    assert.equal(r.archived, 0);
    assert.equal(r.archivePath, null);
    assert.match(r.message, /No audit entries/);
  });

  it("zips entries into archives/ named by first/last timestamps and removes originals", () => {
    writeEntry("a.json", "2026-04-25T10:00:00.000Z");
    writeEntry("b.json", "2026-04-26T10:00:00.000Z");
    writeEntry("c.json", "2026-04-27T10:00:00.000Z");

    const r = compact();
    assert.equal(r.archived, 3);
    assert.ok(r.archivePath);
    assert.match(
      path.basename(r.archivePath),
      /^2026-04-25T10-00-00\.000Z_2026-04-27T10-00-00\.000Z\.zip$/,
    );
    assert.ok(fs.existsSync(r.archivePath));
    assert.equal(path.dirname(r.archivePath), path.join(dest, "archives"));

    // Originals are gone
    const remaining = fs.readdirSync(dest).filter((f) => f.endsWith(".json"));
    assert.equal(remaining.length, 0);

    // Archive contains all three entries
    const zip = new AdmZip(r.archivePath);
    const names = zip
      .getEntries()
      .map((e) => e.entryName)
      .sort();
    assert.deepEqual(names, ["a.json", "b.json", "c.json"]);
  });

  it("ignores files inside the archives subfolder", () => {
    fs.writeFileSync(path.join(dest, "archives", "preexisting.json"), "{}");
    writeEntry("a.json", "2026-04-27T10:00:00.000Z");
    const r = compact();
    assert.equal(r.archived, 1);
    assert.ok(fs.existsSync(path.join(dest, "archives", "preexisting.json")));
  });

  it("falls back to mtime when timestamp field is missing", () => {
    fs.writeFileSync(path.join(dest, "no-ts.json"), JSON.stringify({ message: "x" }));
    const r = compact();
    assert.equal(r.archived, 1);
    assert.ok(r.archivePath);
  });

  it("creates a unique archive path on collision", () => {
    writeEntry("a.json", "2026-04-25T10:00:00.000Z");
    writeEntry("b.json", "2026-04-25T10:00:00.000Z");
    const r1 = compact();
    assert.ok(r1.archivePath);
    // Re-create entries with the same bounds and run compact again
    writeEntry("c.json", "2026-04-25T10:00:00.000Z");
    writeEntry("d.json", "2026-04-25T10:00:00.000Z");
    const r2 = compact();
    assert.ok(r2.archivePath);
    assert.notEqual(r1.archivePath, r2.archivePath);
    assert.ok(fs.existsSync(r1.archivePath));
    assert.ok(fs.existsSync(r2.archivePath));
  });
});
