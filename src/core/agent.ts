import { readFileSync } from "node:fs";
import { ClaudeClient, type AgentResponse } from "../ai/claude.js";
import { ConversationManager } from "../ai/context.js";
import type { EventBus } from "./event-bus.js";
import type { StateStore } from "./state.js";
import type { PluginHost } from "./plugin-host.js";
import type { NixClawConfig } from "./config.js";
import type { NixClawMessage } from "./types.js";

const SYSTEM_PROMPT = `You are NixClaw, a personal AI agent running on a NixOS system.
You help your user manage their NixOS system, development workflows, and daily tasks.
Be concise and direct. When using tools, explain what you're doing briefly.
If a task requires system changes (like nixos-rebuild), propose the change and ask the user to execute it.`;

export class Agent {
  private claude: ClaudeClient;
  private conversations: ConversationManager;

  constructor(
    private config: NixClawConfig,
    private eventBus: EventBus,
    private state: StateStore,
    private pluginHost: PluginHost,
  ) {
    const apiKey = readFileSync(config.ai.apiKeyFile, "utf-8").trim();
    this.claude = new ClaudeClient(apiKey, config.ai.model);
    this.conversations = new ConversationManager(state);

    this.eventBus.on("message:incoming", (payload) => {
      this.handleMessage(payload as NixClawMessage).catch((err) => {
        console.error("[agent] Error handling message:", err);
      });
    });
  }

  private async handleMessage(msg: NixClawMessage): Promise<void> {
    const conversationId = `${msg.channel}:${msg.sender}`;
    this.conversations.addUserMessage(conversationId, msg.text);
    const messages = this.conversations.getMessages(conversationId);
    const tools = this.pluginHost.getTools();
    const response = await this.claude.chat(messages, tools, SYSTEM_PROMPT);
    this.conversations.addAssistantMessage(conversationId, response.text);
    this.eventBus.emit("message:response", {
      id: msg.id,
      channel: msg.channel,
      sender: msg.sender,
      text: response.text,
      toolResults: response.toolResults,
      replyTo: msg.id,
    });
  }
}
