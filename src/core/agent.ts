import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { ClaudeClient, type AgentResponse, type ApprovalGate } from "../ai/claude.js";
import { ConversationManager } from "../ai/context.js";
import { loadPersonality } from "./personality.js";
import { ApprovalStore } from "./approval.js";
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
  private approvalStore: ApprovalStore;
  private approvalTimeoutMs: number;

  constructor(
    private config: AgentConfig,
    private eventBus: EventBus,
    private state: StateStore,
    private pluginHost: PluginHost,
    globalDir?: string,
  ) {
    const workspaceDir = config.workspaceDir ?? join(homedir(), ".config/clawnix");
    this.systemPrompt = loadPersonality(workspaceDir, globalDir);
    const apiKey = readFileSync(config.ai.apiKeyFile, "utf-8").trim();
    this.claude = new ClaudeClient(apiKey, config.ai.model);
    this.conversations = new ConversationManager(state);
    this.approvalStore = new ApprovalStore(state);
    this.approvalTimeoutMs = ("security" in config ? (config as ClawNixConfig).security.approvalTimeoutSeconds : 300) * 1000;

    this.eventBus.on("message:incoming", (payload) => {
      console.log("[agent] Received message:", JSON.stringify(payload));
      this.handleMessage(payload as ClawNixMessage).catch((err) => {
        console.error("[agent] Error handling message:", err);
      });
    });
    console.log("[agent] Agent initialized, listening for messages");
  }

  private buildApprovalGate(channel: string, sender: string): ApprovalGate {
    return async (toolName: string, input: unknown): Promise<"allow" | "deny"> => {
      const decision = this.pluginHost.evaluateToolPolicy(toolName, channel, sender);
      if (decision === "allow") return "allow";
      if (decision === "deny") return "deny";

      // decision === "approve" — request human approval and wait
      const conversationId = `${channel}:${sender}`;
      const id = this.approvalStore.requestApproval({
        tool: toolName,
        input: JSON.stringify(input),
        session: conversationId,
        requester: sender,
      });

      console.log(`[agent] Approval required for ${toolName} [${id}], waiting...`);
      this.eventBus.emit("approval:request", {
        id,
        tool: toolName,
        input: JSON.stringify(input),
        session: conversationId,
        requester: sender,
      });

      return new Promise<"allow" | "deny">((resolve) => {
        const timeout = setTimeout(() => {
          cleanup();
          this.approvalStore.decide(id, "deny");
          console.log(`[agent] Approval ${id} timed out`);
          resolve("deny");
        }, this.approvalTimeoutMs);

        // Listen for decision from Telegram or WebUI
        const cleanup = this.eventBus.on("approval:decide", (payload: unknown) => {
          const cmd = payload as { id: string; decision: "allow" | "deny" };
          if (cmd.id !== id) return;
          clearTimeout(timeout);
          cleanup();
          this.approvalStore.decide(id, cmd.decision);
          console.log(`[agent] Approval ${id}: ${cmd.decision}`);
          resolve(cmd.decision);
        });
      });
    };
  }

  private async handleMessage(msg: ClawNixMessage): Promise<void> {
    const conversationId = `${msg.channel}:${msg.sender}`;
    console.log("[agent] Processing message for conversation:", conversationId);
    this.conversations.addUserMessage(conversationId, msg.text);
    const messages = this.conversations.getMessages(conversationId);
    const tools = this.pluginHost.getToolsForContext(msg.channel, msg.sender);
    const approvalGate = this.buildApprovalGate(msg.channel, msg.sender);
    console.log("[agent] Calling Claude with", tools.length, "tools,", messages.length, "messages");
    const response = await this.claude.chat(messages, tools, this.systemPrompt, approvalGate);
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
