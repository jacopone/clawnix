import { z } from "zod";
import { createSocket } from "node:dgram";
import type { ClawNixPlugin, PluginContext } from "../../core/types.js";
import { runCommand } from "../nixos/commands.js";

export function sdNotify(message: string): void {
  const socketPath = process.env.NOTIFY_SOCKET;
  if (!socketPath) return;

  try {
    const sock = createSocket("unix_dgram");
    sock.send(Buffer.from(message), 0, message.length, socketPath, () => {
      sock.close();
    });
  } catch {
    // Ignore errors — watchdog is best-effort
  }
}

export class WatchdogPlugin implements ClawNixPlugin {
  name = "watchdog";
  version = "0.1.0";
  private interval?: ReturnType<typeof setInterval>;

  async init(ctx: PluginContext): Promise<void> {
    this.interval = setInterval(() => sdNotify("WATCHDOG=1"), 15_000);
    sdNotify("READY=1");

    ctx.registerTool({
      name: "clawnix_agent_health",
      description:
        "Check health of ClawNix agent services. Shows recent journal entries for failed or restarted clawnix services.",
      inputSchema: z.object({
        service: z.string().optional().describe("Specific service name (default: all clawnix-* services)"),
      }),
      run: async (input) => {
        const { service } = input as { service?: string };
        const unit = service ?? "clawnix-*";
        return runCommand("journalctl", [
          "-u", unit,
          "--since", "1 hour ago",
          "--priority", "warning",
          "--no-pager",
          "-n", "50",
        ]);
      },
    });

    ctx.logger.info("Watchdog plugin started (sd_notify ping every 15s)");
  }

  async shutdown(): Promise<void> {
    if (this.interval) clearInterval(this.interval);
    sdNotify("STOPPING=1");
  }
}
