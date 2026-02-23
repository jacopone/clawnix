import { z } from "zod";
import type { ClawNixPlugin, PluginContext } from "../../core/types.js";
import {
  getSystemStatus,
  flakeCheck,
  serviceStatus,
  listServices,
  nixosOption,
  flakeUpdate,
  systemRebuild,
  systemRollback,
} from "./commands.js";
import { listGenerations, diffGenerations } from "./generations.js";

interface NixOSToolsConfig {
  flakePath?: string;
}

export class NixOSToolsPlugin implements ClawNixPlugin {
  name = "nixos-tools";
  version = "0.1.0";

  async init(ctx: PluginContext): Promise<void> {
    const config = ctx.config as unknown as NixOSToolsConfig;
    const flakePath = config.flakePath ?? ".";

    ctx.registerTool({
      name: "clawnix_system_status",
      description:
        "Get NixOS system status: hostname, uptime, current generation",
      inputSchema: z.object({}),
      run: async () => getSystemStatus(),
    });

    ctx.registerTool({
      name: "clawnix_flake_check",
      description:
        "Run 'nix flake check' on the NixOS configuration to validate it",
      inputSchema: z.object({}),
      run: async () => flakeCheck(flakePath),
    });

    ctx.registerTool({
      name: "clawnix_service_status",
      description: "Get the status of a systemd service",
      inputSchema: z.object({
        service: z
          .string()
          .describe(
            "Name of the systemd service, e.g. 'nginx' or 'clawnix'"
          ),
      }),
      run: async (input) => {
        const { service } = input as { service: string };
        return serviceStatus(service);
      },
    });

    ctx.registerTool({
      name: "clawnix_list_services",
      description: "List all running systemd services",
      inputSchema: z.object({}),
      run: async () => listServices(),
    });

    ctx.registerTool({
      name: "clawnix_generations",
      description:
        "List NixOS system generations with dates and current marker. Shows the history of system configurations.",
      inputSchema: z.object({}),
      run: async () => listGenerations(),
    });

    ctx.registerTool({
      name: "clawnix_generation_diff",
      description:
        "Compare two NixOS generations showing added, removed, and changed packages. Use this to understand what changed between system rebuilds.",
      inputSchema: z.object({
        gen1: z.number().describe("First (older) generation number"),
        gen2: z.number().describe("Second (newer) generation number"),
      }),
      run: async (input) => {
        const { gen1, gen2 } = input as { gen1: number; gen2: number };
        return diffGenerations(gen1, gen2);
      },
    });

    ctx.registerTool({
      name: "clawnix_nixos_option",
      description:
        "Query the current value and description of a NixOS configuration option (e.g. 'services.openssh.enable', 'networking.firewall.allowedTCPPorts')",
      inputSchema: z.object({
        option: z.string().describe("NixOS option path, e.g. 'services.openssh.enable'"),
      }),
      run: async (input) => {
        const { option } = input as { option: string };
        return nixosOption(option);
      },
    });

    ctx.registerTool({
      name: "clawnix_flake_update",
      description: "Update flake.lock to pull the latest nixpkgs and other inputs. Does not rebuild the system.",
      inputSchema: z.object({}),
      run: async () => flakeUpdate(flakePath),
    });

    ctx.registerTool({
      name: "clawnix_system_rebuild",
      description:
        "Rebuild and switch to the new NixOS configuration. Requires sudo NOPASSWD for nixos-rebuild. " +
        "Run clawnix_flake_update first to get new packages, then this to apply.",
      inputSchema: z.object({}),
      run: async () => systemRebuild(flakePath),
    });

    ctx.registerTool({
      name: "clawnix_system_rollback",
      description:
        "Roll back to the previous NixOS generation. Use if a rebuild causes problems.",
      inputSchema: z.object({}),
      run: async () => systemRollback(),
    });

    ctx.logger.info(`NixOS tools registered: 10 tools (flakePath: ${flakePath})`);
  }

  async shutdown(): Promise<void> {}
}
