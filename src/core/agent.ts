import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { ClaudeClient, type AgentResponse } from "../ai/claude.js";
import { ConversationManager } from "../ai/context.js";
import { loadPersonality } from "./personality.js";
import type { EventBus } from "./event-bus.js";
import type { StateStore } from "./state.js";
import type { PluginHost } from "./plugin-host.js";
import type { ClawNixConfig, AgentInstanceConfig } from "./config.js";
import type { ClawNixMessage } from "./types.js";

export type AgentConfig = ClawNixConfig | AgentInstanceConfig;

export class Agent {
  private claude: ClaudeClient;
  private conversations: ConversationManager;
  private systemPrompt: string;

  constructor(
    private config: AgentConfig,
    private eventBus: EventBus,
    private state: StateStore,
    private pluginHost: PluginHost,
  ) {
    const workspaceDir = config.workspaceDir ?? join(homedir(), ".config/clawnix");
    this.systemPrompt = loadPersonality(workspaceDir);
    const apiKey = readFileSync(config.ai.apiKeyFile, "utf-8").trim();
    this.claude = new ClaudeClient(apiKey, config.ai.model);
    this.conversations = new ConversationManager(state);

    this.eventBus.on("message:incoming", (payload) => {
      console.log("[agent] Received message:", JSON.stringify(payload));
      this.handleMessage(payload as ClawNixMessage).catch((err) => {
        console.error("[agent] Error handling message:", err);
      });
    });
    console.log("[agent] Agent initialized, listening for messages");
  }

  private async handleMessage(msg: ClawNixMessage): Promise<void> {
    const conversationId = `${msg.channel}:${msg.sender}`;
    console.log("[agent] Processing message for conversation:", conversationId);
    this.conversations.addUserMessage(conversationId, msg.text);
    const messages = this.conversations.getMessages(conversationId);
    const tools = this.pluginHost.getToolsForContext(msg.channel, msg.sender);
    console.log("[agent] Calling Claude with", tools.length, "tools,", messages.length, "messages");
    const response = await this.claude.chat(messages, tools, this.systemPrompt);
    console.log("[agent] Claude responded:", response.text.substring(0, 100));
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
