import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

async function runCommand(cmd: string, args: string[], cwd?: string): Promise<string> {
  try {
    const { stdout, stderr } = await exec(cmd, args, { timeout: 30000, cwd });
    return stdout + (stderr ? `\nSTDERR: ${stderr}` : "");
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    return `Error: ${e.message}\n${e.stdout ?? ""}\n${e.stderr ?? ""}`.trim();
  }
}

export async function gitStatus(projectDir: string): Promise<string> {
  const [status, log] = await Promise.all([
    runCommand("git", ["status", "--short"], projectDir),
    runCommand("git", ["log", "--oneline", "-10"], projectDir),
  ]);
  return `Status:\n${status}\nRecent commits:\n${log}`;
}

export async function runTests(projectDir: string): Promise<string> {
  return runCommand("npm", ["test", "--", "--run"], projectDir);
}

export async function listClaudeSessions(): Promise<string> {
  return runCommand("tmux", ["list-sessions", "-F", "#{session_name}"]).catch(
    () => "No tmux sessions found",
  );
}
