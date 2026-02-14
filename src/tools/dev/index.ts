import { z } from "zod";
import type { NixClawPlugin, PluginContext } from "../../core/types.js";
import { gitStatus, runTests, listClaudeSessions } from "./commands.js";

export class DevToolsPlugin implements NixClawPlugin {
  name = "dev-tools";
  version = "0.1.0";

  async init(ctx: PluginContext): Promise<void> {
    ctx.registerTool({
      name: "nixclaw_git_status",
      description: "Get git status and recent commits for a project directory",
      inputSchema: z.object({
        projectDir: z.string().describe("Absolute path to the project directory"),
      }),
      run: async (input) => {
        const { projectDir } = input as { projectDir: string };
        return gitStatus(projectDir);
      },
    });

    ctx.registerTool({
      name: "nixclaw_run_tests",
      description: "Run tests in a project directory (npm test)",
      inputSchema: z.object({
        projectDir: z.string().describe("Absolute path to the project directory"),
      }),
      run: async (input) => {
        const { projectDir } = input as { projectDir: string };
        return runTests(projectDir);
      },
    });

    ctx.registerTool({
      name: "nixclaw_claude_sessions",
      description: "List active Claude tmux sessions",
      inputSchema: z.object({}),
      run: async () => listClaudeSessions(),
    });

    ctx.logger.info("Dev tools registered");
  }

  async shutdown(): Promise<void> {}
}
