import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { fileURLToPath } from "node:url";
import { compact } from "./compact.ts";
import { DEFAULT_DEST_DIR, readConfig } from "./config.ts";
import { runHook } from "./hook.ts";
import { install, uninstall } from "./installer.ts";

interface ParsedArgs {
  command: string | null;
  dest: string | null;
  yes: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { command: null, dest: null, yes: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (arg === "--version" || arg === "-v") {
      process.stdout.write(`${readPackageVersion()}\n`);
      process.exit(0);
    } else if (arg === "--dest") {
      const next = argv[++i];
      if (!next) {
        process.stderr.write("Error: --dest requires a path argument\n");
        process.exit(1);
      }
      out.dest = next;
    } else if (arg === "--yes" || arg === "-y") {
      out.yes = true;
    } else if (
      arg === "install" ||
      arg === "uninstall" ||
      arg === "hook" ||
      arg === "compact" ||
      arg === "status"
    ) {
      out.command = arg;
    } else {
      process.stderr.write(`Unknown argument: ${arg}\n`);
      printHelp();
      process.exit(1);
    }
  }
  return out;
}

function printHelp(): void {
  process.stdout.write(
    `claude-code-audit-trail - Persist Claude Code prompts as JSON audit entries

Usage:
  claude-code-audit-trail install [--dest <path>] [--yes]
                                Install the UserPromptSubmit hook + skill.
                                Without --dest, prompts interactively.
                                With --yes, accepts the default ~/.claude/audit-trail.
  claude-code-audit-trail uninstall
                                Remove the hook + skill (audit data preserved).
  claude-code-audit-trail compact
                                Zip existing entries into archives/{first}_{last}.zip.
  claude-code-audit-trail status
                                Print current config / hook state.
  claude-code-audit-trail hook  Internal: read stdin, write one audit entry.

Options:
  --dest <path>  Destination folder for audit entries.
  --yes, -y      Skip prompts and accept defaults.
  -h, --help     Show this help.
  -v, --version  Show version.
`,
  );
}

function readPackageVersion(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      path.resolve(here, "..", "package.json"),
      path.resolve(here, "..", "..", "package.json"),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        const pkg = JSON.parse(fs.readFileSync(c, "utf-8")) as { version?: string };
        if (typeof pkg.version === "string") return pkg.version;
      }
    }
  } catch {
    /* ignore */
  }
  return "0.0.0";
}

async function promptForDest(defaultDest: string): Promise<string> {
  if (!process.stdin.isTTY) return defaultDest;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise<string>((resolve) => {
      rl.question(`Audit trail destination [${defaultDest}]: `, (a) => resolve(a));
    });
    const trimmed = answer.trim();
    return trimmed.length > 0 ? trimmed : defaultDest;
  } finally {
    rl.close();
  }
}

async function cmdInstall(args: ParsedArgs): Promise<number> {
  const dest = args.dest ?? (args.yes ? DEFAULT_DEST_DIR : await promptForDest(DEFAULT_DEST_DIR));
  const result = install({ destDir: dest, packageVersion: readPackageVersion() });
  process.stdout.write(`Installed claude-code-audit-trail.\n`);
  process.stdout.write(`  Destination: ${result.destDir}\n`);
  process.stdout.write(`  Settings:    ${result.settingsPath}\n`);
  if (result.skillInstalled) {
    process.stdout.write(`  Skill:       ${result.skillPath}\n`);
  } else {
    process.stdout.write(
      `  Skill:       skipped (${result.skillError ?? "bundled file missing"})\n`,
    );
  }
  return 0;
}

function cmdUninstall(): number {
  const result = uninstall();
  process.stdout.write(
    `Uninstalled claude-code-audit-trail (hook removed: ${result.hookRemoved}, skill removed: ${result.skillRemoved}).\n`,
  );
  return 0;
}

function cmdCompact(): number {
  try {
    const result = compact();
    process.stdout.write(`${result.message}\n`);
    return 0;
  } catch (err) {
    process.stderr.write(`compact failed: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

function cmdStatus(): number {
  const config = readConfig();
  if (!config) {
    process.stdout.write("Not installed. Run `install` to get started.\n");
    return 0;
  }
  process.stdout.write(`Destination: ${config.destDir}\n`);
  process.stdout.write(`Version:     ${config.version}\n`);
  return 0;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  if (!args.command) {
    printHelp();
    process.exit(1);
  }
  let code = 0;
  switch (args.command) {
    case "install":
      code = await cmdInstall(args);
      break;
    case "uninstall":
      code = cmdUninstall();
      break;
    case "compact":
      code = cmdCompact();
      break;
    case "status":
      code = cmdStatus();
      break;
    case "hook":
      code = await runHook();
      break;
  }
  process.exit(code);
}

main().catch((err) => {
  process.stderr.write(
    `Fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  process.exit(1);
});
