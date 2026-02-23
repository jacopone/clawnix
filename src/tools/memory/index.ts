import { z } from "zod";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ClawNixPlugin, PluginContext } from "../../core/types.js";

interface MemoryConfig {
  workspaceDir: string;
  globalMemoryDir?: string;
}

export class MemoryPlugin implements ClawNixPlugin {
  name = "memory";
  version = "0.1.0";

  async init(ctx: PluginContext): Promise<void> {
    const config = ctx.config as unknown as MemoryConfig;
    const memoryDir = join(config.workspaceDir, "memory");
    mkdirSync(memoryDir, { recursive: true });
    const memoryFile = join(memoryDir, "MEMORY.md");

    ctx.registerTool({
      name: "clawnix_memory_read",
      description:
        "Read the agent's persistent memory file (MEMORY.md). Contains learned preferences, facts, and notes that persist across conversations.",
      inputSchema: z.object({}),
      run: async () => {
        if (!existsSync(memoryFile))
          return "Memory is empty. Use memory_write to save information.";
        return readFileSync(memoryFile, "utf-8");
      },
    });

    ctx.registerTool({
      name: "clawnix_memory_write",
      description:
        "Write to the agent's persistent memory file (MEMORY.md). Use this to save learned preferences, important facts, or notes that should persist across conversations. Overwrites the entire file — read first if you want to append.",
      inputSchema: z.object({
        content: z
          .string()
          .describe("Full content for MEMORY.md (markdown format)"),
      }),
      run: async (input) => {
        const { content } = input as { content: string };
        writeFileSync(memoryFile, content, "utf-8");
        return `Memory updated (${content.length} characters written to MEMORY.md).`;
      },
    });

    ctx.logger.info("Memory plugin registered");
  }

  async shutdown(): Promise<void> {}
}
