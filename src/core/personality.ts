import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";

const DEFAULT_PROMPT = `You are ClawNix, a personal AI agent running on a NixOS system.
You help your user manage their NixOS system, development workflows, and daily tasks.
Be concise and direct. When using tools, explain what you're doing briefly.
If a task requires system changes (like nixos-rebuild), propose the change and ask the user to execute it.`;

function tryRead(path: string): string | null {
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf-8").trim();
}

/**
 * Load skill markdown files from the workspace skills/ directory.
 * Only loads skills whose filename matches an enabled tool name.
 * e.g., skills/browser.md is loaded if "browser" is in enabledTools.
 */
function loadSkills(workspaceDir: string, enabledTools?: string[]): string[] {
  const skillsDir = join(workspaceDir, "skills");
  if (!existsSync(skillsDir)) return [];

  const files = readdirSync(skillsDir).filter((f) => f.endsWith(".md"));
  const sections: string[] = [];

  for (const file of files) {
    const toolName = basename(file, ".md");
    // If enabledTools provided, only load matching skills
    if (enabledTools && !enabledTools.includes(toolName)) continue;
    const content = tryRead(join(skillsDir, file));
    if (content) sections.push(`### ${toolName}\n${content}`);
  }

  return sections;
}

export function loadPersonality(workspaceDir: string, globalDir?: string, enabledTools?: string[]): string {
  const identity = tryRead(join(workspaceDir, "IDENTITY.md"));
  if (!identity) return DEFAULT_PROMPT;

  const sections: string[] = [identity];

  // Global memory shared across all agents
  if (globalDir) {
    const global = tryRead(join(globalDir, "GLOBAL.md"));
    if (global) sections.push(`## Global Knowledge\n${global}`);
  }

  const soul = tryRead(join(workspaceDir, "SOUL.md"));
  if (soul) sections.push(`## Values & Behavior\n${soul}`);

  const user = tryRead(join(workspaceDir, "USER.md"));
  if (user) sections.push(`## User Preferences\n${user}`);

  // Load per-tool skills based on enabled tools
  const skills = loadSkills(workspaceDir, enabledTools);
  if (skills.length > 0) {
    sections.push(`## Tool Skills\n${skills.join("\n\n")}`);
  }

  const memory = tryRead(join(workspaceDir, "memory", "MEMORY.md"));
  if (memory) sections.push(`## Persistent Knowledge\n${memory}`);

  return sections.join("\n\n");
}
