import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ClawNixPlugin, PluginContext, ClawNixMessage } from "../../core/types.js";
import type { EventBus } from "../../core/event-bus.js";

interface HeartbeatConfig {
  workspaceDir: string;
  intervalMinutes?: number;
}

export class HeartbeatPlugin implements ClawNixPlugin {
  name = "heartbeat";
  version = "0.1.0";
  private interval?: ReturnType<typeof setInterval>;
  private eventBus?: EventBus;
  private workspaceDir = "";

  async init(ctx: PluginContext): Promise<void> {
    const config = ctx.config as unknown as HeartbeatConfig;
    this.workspaceDir = config.workspaceDir;
    this.eventBus = ctx.eventBus;
    const minutes = config.intervalMinutes ?? 30;

    if (minutes > 0) {
      this.interval = setInterval(() => this.tick(), minutes * 60 * 1000);
      ctx.logger.info(`Heartbeat service started (every ${minutes} minutes)`);
    }
  }

  tick(): void {
    const heartbeatPath = join(this.workspaceDir, "HEARTBEAT.md");
    if (!existsSync(heartbeatPath)) return;

    const content = readFileSync(heartbeatPath, "utf-8").trim();
    if (!content) return;

    const msg: ClawNixMessage = {
      id: randomUUID(),
      channel: "heartbeat",
      sender: "heartbeat",
      text: `[Heartbeat Task] ${content}`,
      timestamp: new Date(),
    };
    this.eventBus?.emit("message:incoming", msg);
  }

  async shutdown(): Promise<void> {
    if (this.interval) clearInterval(this.interval);
  }
}
