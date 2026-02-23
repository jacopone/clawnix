import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { ClawNixPlugin, PluginContext } from "../../core/types.js";

const exec = promisify(execFile);

const MAX_OUTPUT_BYTES = 102400; // 100KB

const BLOCKED_COMMAND_PATTERNS = [
  /\bsudo\b/,
  /\brm\s+-rf\b/,
  /\bmkfs\b/,
  /\bdd\b.*\bof=/,
  /[;&|`]/,
  /\$\(/,
  /\$\{/,
  />\s*[^\s]/,
];

interface ExecConfig {
  allowedPackages?: string[];
  defaultTimeout?: number;
}

export class ExecPlugin implements ClawNixPlugin {
  name = "exec";
  version = "0.1.0";

  async init(ctx: PluginContext): Promise<void> {
    const config = ctx.config as unknown as ExecConfig;
    const allowedPackages = new Set(config.allowedPackages ?? []);
    const defaultTimeout = config.defaultTimeout ?? 30;

    ctx.registerTool({
      name: "clawnix_exec",
      description:
        "Execute a command using a nixpkgs package via nix shell. " +
        "Packages in the allowlist run immediately; others require user approval. " +
        "Example: package='jq', command='jq .name package.json'",
      inputSchema: z.object({
        package: z.string().describe("nixpkgs package name (e.g. 'jq', 'ripgrep', 'httpie')"),
        command: z.string().describe("Command to run inside the nix shell"),
        timeout: z.number().optional().describe("Timeout in seconds (default: 30, max: 300)"),
      }),
      run: async (input) => {
        const { package: pkg, command, timeout } = input as {
          package: string;
          command: string;
          timeout?: number;
        };

        // Validate command against blocked patterns
        for (const pattern of BLOCKED_COMMAND_PATTERNS) {
          if (pattern.test(command)) {
            return `BLOCKED: Command contains a forbidden pattern.`;
          }
        }

        const timeoutSec = Math.min(timeout ?? defaultTimeout, 300);
        const isAllowed = allowedPackages.has(pkg);

        if (!isAllowed) {
          // Tool policy with effect "approve" handles this at the approval gate level.
          // If we reach here, the package isn't in the allowlist but was approved
          // (or no policy exists). Log it.
          ctx.logger.info(`Executing non-allowlisted package: ${pkg}`);
        }

        try {
          const { stdout, stderr } = await exec(
            "nix",
            ["shell", `nixpkgs#${pkg}`, "--command", "sh", "-c", command],
            { timeout: timeoutSec * 1000 },
          );

          let output = stdout + (stderr ? `\nSTDERR: ${stderr}` : "");
          if (output.length > MAX_OUTPUT_BYTES) {
            output = output.slice(0, MAX_OUTPUT_BYTES) + `\n... (truncated at ${MAX_OUTPUT_BYTES} bytes)`;
          }
          return output || "(no output)";
        } catch (err: unknown) {
          const e = err as { stdout?: string; stderr?: string; message: string; killed?: boolean };
          if (e.killed) {
            return `Error: Command timed out after ${timeoutSec} seconds.`;
          }
          return `Error: ${e.message}\n${e.stdout ?? ""}\n${e.stderr ?? ""}`.trim();
        }
      },
    });

    ctx.logger.info(
      `Exec plugin registered (${allowedPackages.size} allowed packages: ${[...allowedPackages].join(", ") || "none"})`,
    );
  }

  async shutdown(): Promise<void> {}
}
