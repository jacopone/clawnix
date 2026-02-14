import { z } from "zod";
import type { NixClawPlugin, PluginContext } from "../../core/types.js";
import {
  getSystemStatus,
  flakeCheck,
  serviceStatus,
  listServices,
} from "./commands.js";

interface NixOSToolsConfig {
  flakePath?: string;
}

export class NixOSToolsPlugin implements NixClawPlugin {
  name = "nixos-tools";
  version = "0.1.0";

  async init(ctx: PluginContext): Promise<void> {
    const config = ctx.config as unknown as NixOSToolsConfig;
    const flakePath = config.flakePath ?? ".";

    ctx.registerTool({
      name: "nixclaw_system_status",
      description:
        "Get NixOS system status: hostname, uptime, current generation",
      inputSchema: z.object({}),
      run: async () => getSystemStatus(),
    });

    ctx.registerTool({
      name: "nixclaw_flake_check",
      description:
        "Run 'nix flake check' on the NixOS configuration to validate it",
      inputSchema: z.object({}),
      run: async () => flakeCheck(flakePath),
    });

    ctx.registerTool({
      name: "nixclaw_service_status",
      description: "Get the status of a systemd service",
      inputSchema: z.object({
        service: z
          .string()
          .describe(
            "Name of the systemd service, e.g. 'nginx' or 'nixclaw'"
          ),
      }),
      run: async (input) => {
        const { service } = input as { service: string };
        return serviceStatus(service);
      },
    });

    ctx.registerTool({
      name: "nixclaw_list_services",
      description: "List all running systemd services",
      inputSchema: z.object({}),
      run: async () => listServices(),
    });

    ctx.logger.info(`NixOS tools registered (flakePath: ${flakePath})`);
  }

  async shutdown(): Promise<void> {}
}
