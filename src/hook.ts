import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { archivesDir, readConfig } from "./config.ts";
import { collectGitInfo, type GitInfo } from "./git.ts";
import { buildEntryFilename, normalizeCwd } from "./paths.ts";

interface HookPayload {
  session_id?: string;
  cwd?: string;
  prompt?: string;
  hook_event_name?: string;
  transcript_path?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_response?: unknown;
}

export type EventType = "user_prompt" | "tool_answer";

export interface AuditEntry {
  timestamp: string;
  session_name: string;
  directory: string;
  git: GitInfo | null;
  event_type: EventType;
  message: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_response?: unknown;
}

const TRACKED_TOOLS = new Set(["AskUserQuestion", "ExitPlanMode"]);

/**
 * Reads a Claude Code hook payload from stdin and writes one audit entry.
 * Best-effort: any failure is logged to stderr and the process exits 0 so
 * the hook never blocks the user's session.
 */
export async function runHook(): Promise<number> {
  try {
    const config = readConfig();
    if (!config) {
      // Not installed — silently no-op; hook fired but user hasn't run install.
      return 0;
    }
    const raw = await readStdin();
    processPayload(raw, config.destDir);
    return 0;
  } catch (err) {
    process.stderr.write(`audit-trail hook error: ${formatError(err)}\n`);
    return 0;
  }
}

/**
 * Pure entry point used by tests and the hook command. Returns the absolute
 * path of the written entry, or `null` if there was nothing to write.
 */
export function processPayload(raw: string, destDir: string): string | null {
  const payload = parsePayload(raw);
  const event = payload.hook_event_name;

  if (event === "PostToolUse") {
    return processToolEvent(payload, destDir);
  }
  // Default: treat as UserPromptSubmit (also covers absent event for back-compat).
  return processUserPrompt(payload, destDir);
}

function processUserPrompt(payload: HookPayload, destDir: string): string | null {
  const directory = normalizeCwd(payload.cwd ?? process.cwd());
  const entry: AuditEntry = {
    timestamp: new Date().toISOString(),
    session_name: payload.session_id ?? "unknown",
    directory,
    git: collectGitInfo(directory),
    event_type: "user_prompt",
    message: payload.prompt ?? "",
  };
  return writeEntry(destDir, entry);
}

function processToolEvent(payload: HookPayload, destDir: string): string | null {
  const toolName = payload.tool_name;
  if (!toolName || !TRACKED_TOOLS.has(toolName)) return null;

  const message = extractUserText(toolName, payload.tool_input, payload.tool_response);
  if (!message) return null;

  const directory = normalizeCwd(payload.cwd ?? process.cwd());
  const entry: AuditEntry = {
    timestamp: new Date().toISOString(),
    session_name: payload.session_id ?? "unknown",
    directory,
    git: collectGitInfo(directory),
    event_type: "tool_answer",
    message,
    tool_name: toolName,
    tool_input: payload.tool_input,
    tool_response: payload.tool_response,
  };
  return writeEntry(destDir, entry);
}

function extractUserText(toolName: string, input: unknown, response: unknown): string | null {
  if (toolName === "AskUserQuestion") {
    return extractAnswers(input) ?? extractAnswers(response);
  }
  if (toolName === "ExitPlanMode") {
    return extractRejectionFeedback(response);
  }
  return null;
}

function extractAnswers(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const answers = (value as Record<string, unknown>).answers;
  if (typeof answers !== "object" || answers === null) return null;
  const keys = Object.keys(answers as Record<string, unknown>);
  if (keys.length === 0) return null;
  return JSON.stringify(answers);
}

const REJECTION_FEEDBACK_FIELDS = ["user_response", "feedback", "reason", "message"];

function extractRejectionFeedback(response: unknown): string | null {
  if (typeof response === "object" && response !== null) {
    const obj = response as Record<string, unknown>;
    for (const key of REJECTION_FEEDBACK_FIELDS) {
      const v = obj[key];
      if (typeof v === "string" && v.trim().length > 0) return v;
    }
  }
  return null;
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (process.stdin.isTTY) {
      resolve("");
      return;
    }
    const chunks: Buffer[] = [];
    process.stdin.on("data", (c) => chunks.push(Buffer.from(c)));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    process.stdin.on("error", reject);
  });
}

function parsePayload(raw: string): HookPayload {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as HookPayload) : {};
  } catch {
    return {};
  }
}

function writeEntry(destDir: string, entry: AuditEntry): string {
  fs.mkdirSync(destDir, { recursive: true });
  const filename = buildEntryFilename(
    entry.timestamp,
    entry.session_name,
    randomBytes(2).toString("hex"),
  );
  const finalPath = path.join(destDir, filename);
  if (path.resolve(finalPath).startsWith(path.resolve(archivesDir(destDir)) + path.sep)) {
    throw new Error("refusing to write entry inside archives directory");
  }
  const tmpPath = `${finalPath}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(entry, null, 2)}\n`);
  fs.renameSync(tmpPath, finalPath);
  return finalPath;
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.stack || err.message;
  return String(err);
}
