import { Bot } from "grammy";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { NixClawPlugin, PluginContext, NixClawMessage } from "../../core/types.js";

interface TelegramConfig {
  botTokenFile: string;
  allowedUsers?: string[];
}

export class TelegramChannel implements NixClawPlugin {
  name = "telegram";
  version = "0.1.0";
  private bot?: Bot;
  private cleanup?: () => void;

  isAllowedUser(userId: string, allowedUsers: string[]): boolean {
    if (allowedUsers.length === 0) return true;
    return allowedUsers.includes(userId);
  }

  async init(ctx: PluginContext): Promise<void> {
    const config = ctx.config as unknown as TelegramConfig;
    if (!config.botTokenFile) {
      ctx.logger.warn("No botTokenFile configured, skipping Telegram");
      return;
    }

    const token = readFileSync(config.botTokenFile, "utf-8").trim();
    const allowedUsers = config.allowedUsers ?? [];

    this.bot = new Bot(token);

    this.bot.on("message:text", async (gramCtx) => {
      const userId = String(gramCtx.from.id);
      if (!this.isAllowedUser(userId, allowedUsers)) {
        await gramCtx.reply("Access denied.");
        return;
      }

      const msg: NixClawMessage = {
        id: randomUUID(),
        channel: "telegram",
        sender: userId,
        text: gramCtx.message.text,
        timestamp: new Date(gramCtx.message.date * 1000),
      };
      ctx.eventBus.emit("message:incoming", msg);
    });

    this.cleanup = ctx.eventBus.on("message:response", async (payload: unknown) => {
      const response = payload as { channel: string; sender: string; text: string };
      if (response.channel !== "telegram") return;

      try {
        await this.bot!.api.sendMessage(Number(response.sender), response.text, {
          parse_mode: "Markdown",
        });
      } catch {
        try {
          await this.bot!.api.sendMessage(Number(response.sender), response.text);
        } catch (fallbackErr) {
          ctx.logger.error("Failed to send Telegram message:", fallbackErr);
        }
      }
    });

    this.bot.start({ onStart: () => ctx.logger.info("Telegram bot started") });
  }

  async shutdown(): Promise<void> {
    this.cleanup?.();
    this.bot?.stop();
  }
}
