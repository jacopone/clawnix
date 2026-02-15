import type Anthropic from "@anthropic-ai/sdk";
import type { StateStore } from "../core/state.js";

const NAMESPACE = "conversations";
const MAX_MESSAGES = 50;

export interface ConversationOptions {
  summarizeThreshold?: number;
}

export class ConversationManager {
  private summarizeThreshold: number;

  constructor(
    private state: StateStore,
    options?: ConversationOptions,
  ) {
    this.summarizeThreshold = options?.summarizeThreshold ?? 40;
  }

  getMessages(conversationId: string): Anthropic.MessageParam[] {
    const messages = this.getRawMessages(conversationId);

    // Prepend summary as context if it exists
    const summary = this.getSummary(conversationId);
    if (summary && messages.length > 0) {
      return [
        { role: "user", content: `[Previous conversation summary: ${summary}]` },
        { role: "assistant", content: "Understood, I have context from our previous conversation." },
        ...messages,
      ];
    }

    return messages;
  }

  addUserMessage(conversationId: string, text: string): void {
    this.append(conversationId, { role: "user", content: text });
  }

  addAssistantMessage(conversationId: string, text: string): void {
    this.append(conversationId, { role: "assistant", content: text });
  }

  needsSummarization(conversationId: string): boolean {
    const messages = this.getRawMessages(conversationId);
    return messages.length >= this.summarizeThreshold;
  }

  setSummary(conversationId: string, summary: string): void {
    this.state.set("summaries", conversationId, summary);
  }

  getSummary(conversationId: string): string | undefined {
    return this.state.get("summaries", conversationId);
  }

  trimAfterSummary(conversationId: string): void {
    const messages = this.getRawMessages(conversationId);
    // Keep only the last few messages after summarization
    const recent = messages.slice(-10);
    this.state.setJSON(NAMESPACE, conversationId, recent);
  }

  private getRawMessages(conversationId: string): Anthropic.MessageParam[] {
    const raw = this.state.getJSON<Anthropic.MessageParam[]>(
      NAMESPACE,
      conversationId,
    );
    return raw ?? [];
  }

  private append(
    conversationId: string,
    message: Anthropic.MessageParam,
  ): void {
    const messages = this.getRawMessages(conversationId);
    messages.push(message);
    const trimmed = messages.slice(-MAX_MESSAGES);
    this.state.setJSON(NAMESPACE, conversationId, trimmed);
  }
}
