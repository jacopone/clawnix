import { createInterface, type Interface } from "node:readline";
import { randomUUID } from "node:crypto";
import type { ClawNixPlugin, PluginContext, ClawNixMessage } from "../../core/types.js";
import type { EventBus } from "../../core/event-bus.js";

export class TerminalChannel implements ClawNixPlugin {
  name = "terminal";
  version = "0.1.0";
  private rl?: Interface;
  private cleanup?: () => void;

  async init(ctx: PluginContext): Promise<void> {
    const { eventBus, logger } = ctx;

    this.cleanup = eventBus.on("message:response", (payload: unknown) => {
      const response = payload as { channel: string; text: string };
      if (response.channel === "terminal") {
        console.log(`\n${response.text}\n`);
        process.stdout.write("clawnix> ");
      }
    });

    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: "clawnix> ",
    });

    this.rl.on("line", (line) => {
      const trimmed = line.trim();
      if (trimmed === "") return;
      if (trimmed === "exit" || trimmed === "quit") {
        this.rl?.close();
        process.exit(0);
      }
      this.processLine(trimmed, eventBus);
    });

    this.rl.prompt();
    logger.info("Terminal channel ready");
  }

  processLine(text: string, eventBus: EventBus): void {
    const msg: ClawNixMessage = {
      id: randomUUID(),
      channel: "terminal",
      sender: "local",
      text,
      timestamp: new Date(),
    };
    eventBus.emit("message:incoming", msg);
  }

  async shutdown(): Promise<void> {
    this.cleanup?.();
    this.rl?.close();
  }
}
