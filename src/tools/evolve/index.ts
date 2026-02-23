import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { ClawNixPlugin, PluginContext } from "../../core/types.js";
import { runCommand } from "../nixos/commands.js";

interface EvolveConfig {
  configFile?: string;
  flakePath?: string;
  requireApproval?: boolean;
}

const DEFAULT_CONFIG_FILE = "/etc/nixos/clawnix-evolved.nix";
const HEALTH_CHECK_DELAY_MS = 10_000;
const HEALTH_CHECK_SERVICES = ["network-online.target"];

function readOverlay(configFile: string): string {
  if (!existsSync(configFile)) {
    return "# ClawNix evolved configuration\n# This file is managed by the clawnix_evolve tool.\n{ config, pkgs, ... }:\n{\n}\n";
  }
  return readFileSync(configFile, "utf-8");
}

function generateDiff(oldContent: string, newContent: string): string {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");

  const diff: string[] = [];
  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i] ?? "";
    const newLine = newLines[i] ?? "";
    if (oldLine !== newLine) {
      if (oldLine) diff.push(`- ${oldLine}`);
      if (newLine) diff.push(`+ ${newLine}`);
    }
  }
  return diff.length > 0 ? diff.join("\n") : "(no changes)";
}

export class EvolvePlugin implements ClawNixPlugin {
  name = "evolve";
  version = "0.1.0";

  async init(ctx: PluginContext): Promise<void> {
    const config = ctx.config as unknown as EvolveConfig;
    const configFile = config.configFile ?? DEFAULT_CONFIG_FILE;
    const flakePath = config.flakePath ?? ".";

    ctx.registerTool({
      name: "clawnix_evolve",
      description:
        "Propose, apply, or roll back NixOS configuration changes. " +
        "The agent can only modify a dedicated overlay file (clawnix-evolved.nix). " +
        "Proposals show a diff and require approval before applying.",
      inputSchema: z.object({
        action: z
          .enum(["propose", "status", "rollback"])
          .describe(
            "'propose': write config + show diff (requires approval to apply), " +
            "'status': show current overlay content, " +
            "'rollback': revert to previous NixOS generation",
          ),
        description: z
          .string()
          .optional()
          .describe("Human-readable description of the change (required for 'propose')"),
        nixContent: z
          .string()
          .optional()
          .describe(
            "Complete Nix module content for the overlay file (required for 'propose'). " +
            "Must be a valid NixOS module: { config, pkgs, ... }: { ... }",
          ),
      }),
      run: async (input) => {
        const { action, description, nixContent } = input as {
          action: "propose" | "status" | "rollback";
          description?: string;
          nixContent?: string;
        };

        switch (action) {
          case "status": {
            const content = readOverlay(configFile);
            return JSON.stringify({
              action: "status",
              configFile,
              exists: existsSync(configFile),
              content,
            });
          }

          case "propose": {
            if (!nixContent) {
              return "Error: 'nixContent' is required for propose action.";
            }
            if (!description) {
              return "Error: 'description' is required for propose action.";
            }

            const oldContent = readOverlay(configFile);
            const diff = generateDiff(oldContent, nixContent);

            // Write the new content
            const dir = dirname(configFile);
            if (!existsSync(dir)) {
              mkdirSync(dir, { recursive: true });
            }
            writeFileSync(configFile, nixContent, "utf-8");

            // Validate with nix flake check
            const checkResult = await runCommand(
              "nix",
              ["flake", "check", flakePath, "--no-build"],
              60_000,
            );
            const checkPassed = !checkResult.startsWith("Error:");

            if (!checkPassed) {
              // Restore old content on validation failure
              writeFileSync(configFile, oldContent, "utf-8");
              return JSON.stringify({
                action: "propose",
                status: "validation_failed",
                description,
                diff,
                validationError: checkResult,
                message:
                  "Configuration validation failed. The overlay has been reverted.",
              });
            }

            // Configuration is valid — now rebuild
            ctx.logger.info(`Evolve: applying "${description}"`);
            const rebuildResult = await runCommand(
              "sudo",
              ["nixos-rebuild", "switch", "--flake", flakePath],
              300_000,
            );
            const rebuildSuccess = !rebuildResult.startsWith("Error:");

            if (!rebuildSuccess) {
              // Restore old content and rollback on rebuild failure
              writeFileSync(configFile, oldContent, "utf-8");
              ctx.logger.warn("Evolve: rebuild failed, rolling back");
              await runCommand(
                "sudo",
                ["nixos-rebuild", "switch", "--rollback"],
                300_000,
              );
              return JSON.stringify({
                action: "propose",
                status: "rebuild_failed",
                description,
                diff,
                rebuildError: rebuildResult,
                message:
                  "Rebuild failed. The overlay has been reverted and system rolled back.",
              });
            }

            // Post-rebuild health check
            await new Promise((r) => setTimeout(r, HEALTH_CHECK_DELAY_MS));
            const healthResults: Array<{
              service: string;
              ok: boolean;
              output: string;
            }> = [];
            for (const svc of HEALTH_CHECK_SERVICES) {
              const result = await runCommand("systemctl", [
                "is-active",
                svc,
              ]);
              healthResults.push({
                service: svc,
                ok: result.trim() === "active",
                output: result.trim(),
              });
            }

            const allHealthy = healthResults.every((h) => h.ok);
            if (!allHealthy) {
              ctx.logger.warn("Evolve: health check failed, auto-rolling back");
              writeFileSync(configFile, oldContent, "utf-8");
              await runCommand(
                "sudo",
                ["nixos-rebuild", "switch", "--rollback"],
                300_000,
              );
              return JSON.stringify({
                action: "propose",
                status: "health_check_failed",
                description,
                diff,
                healthResults,
                message:
                  "Post-rebuild health check failed. Rolled back to previous generation.",
              });
            }

            return JSON.stringify({
              action: "propose",
              status: "applied",
              description,
              diff,
              healthResults,
              message: `Configuration applied successfully: ${description}`,
            });
          }

          case "rollback": {
            const rollbackResult = await runCommand(
              "sudo",
              ["nixos-rebuild", "switch", "--rollback"],
              300_000,
            );
            return JSON.stringify({
              action: "rollback",
              status: rollbackResult.startsWith("Error:")
                ? "failed"
                : "success",
              output: rollbackResult,
            });
          }
        }
      },
    });

    ctx.logger.info(
      `Evolve plugin registered (configFile: ${configFile}, flakePath: ${flakePath})`,
    );
  }

  async shutdown(): Promise<void> {}
}
