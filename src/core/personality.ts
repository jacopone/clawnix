import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_PROMPT = `You are NixClaw, a personal AI agent running on a NixOS system.
You help your user manage their NixOS system, development workflows, and daily tasks.
Be concise and direct. When using tools, explain what you're doing briefly.
If a task requires system changes (like nixos-rebuild), propose the change and ask the user to execute it.`;

function tryRead(path: string): string | null {
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf-8").trim();
}

export function loadPersonality(workspaceDir: string): string {
  const identity = tryRead(join(workspaceDir, "IDENTITY.md"));
  if (!identity) return DEFAULT_PROMPT;

  const sections: string[] = [identity];

  const soul = tryRead(join(workspaceDir, "SOUL.md"));
  if (soul) sections.push(`## Values & Behavior\n${soul}`);

  const user = tryRead(join(workspaceDir, "USER.md"));
  if (user) sections.push(`## User Preferences\n${user}`);

  const memory = tryRead(join(workspaceDir, "memory", "MEMORY.md"));
  if (memory) sections.push(`## Persistent Knowledge\n${memory}`);

  return sections.join("\n\n");
}
