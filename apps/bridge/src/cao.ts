import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "./config.js";

const run = promisify(execFile);

export type SessionState = "running" | "completed" | "error";

// Terminal-state substrings from `cao session status`'s "Status:" line
// (observed lowercase, e.g. "completed" — the underlying TerminalStatus enum
// is uppercase in CAO's own source, so match case-insensitively).
const COMPLETED_STATES = new Set(["completed", "idle"]);
const ERROR_STATES = new Set(["error", "waiting_user_answer"]); // headless can't answer a prompt — treat as stuck, same as error

// workingDirectory is required and explicit, never a silent global default —
// it must come from the task's own project.repoPath. That's the fix for the
// incident where a bridge test ran a real dev agent against this live repo
// and pushed to a real GitHub remote: there is no fallback directory left to
// accidentally point at your own working tree.
export async function launchSession(input: { profile: string; message: string; env: Record<string, string>; workingDirectory: string }): Promise<string> {
  const args = ["launch", "--agents", input.profile, "--headless", "--async", "--yolo"];
  if (config.caoProvider) args.push("--provider", config.caoProvider);
  for (const [key, value] of Object.entries(input.env)) args.push("--env", `${key}=${value}`);
  args.push("--working-directory", input.workingDirectory, input.message);

  const { stdout } = await run(config.caoBin, args);
  const match = stdout.match(/Session created:\s*(\S+)/);
  const sessionName = match?.[1];
  if (!sessionName) throw new Error(`could not parse session name from cao launch output:\n${stdout}`);
  return sessionName;
}

export async function checkSession(sessionName: string): Promise<{ state: SessionState; raw: string }> {
  const { stdout } = await run(config.caoBin, ["session", "status", sessionName, "--workers"]);
  const match = stdout.match(/Status:\s*(\S+)/i);
  const status = (match?.[1] ?? "").toLowerCase();
  if (COMPLETED_STATES.has(status)) return { state: "completed", raw: stdout };
  if (ERROR_STATES.has(status)) return { state: "error", raw: stdout };
  return { state: "running", raw: stdout };
}

// No `cao session shutdown` command exists (checked directly against the
// installed CLI). Cleanup is a direct tmux kill — best-effort, a leftover
// tmux session is harmless clutter, not a correctness problem.
export async function cleanupSession(sessionName: string): Promise<void> {
  await run("tmux", ["kill-session", "-t", sessionName]).catch(() => undefined);
}
