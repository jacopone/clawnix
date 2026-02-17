import { z } from "zod";
import type { EventBus } from "./event-bus.js";
import type { StateStore } from "./state.js";

export interface NixClawMessage {
  id: string;
  channel: string;
  sender: string;
  text: string;
  audio?: Buffer;
  attachments?: Array<{ type: string; url: string }>;
  replyTo?: string;
  timestamp: Date;
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  rawInputSchema?: Record<string, unknown>;
  run: (input: unknown) => Promise<string>;
}

export interface PluginContext {
  eventBus: EventBus;
  registerTool: (tool: Tool) => void;
  state: StateStore;
  config: Record<string, unknown>;
  logger: Logger;
}

export interface NixClawPlugin {
  name: string;
  version: string;
  init(ctx: PluginContext): Promise<void>;
  shutdown(): Promise<void>;
}

export interface Logger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
}
