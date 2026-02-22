import Anthropic from "@anthropic-ai/sdk";
import type { Classifier } from "../core/router.js";

export class HaikuClassifier implements Classifier {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async classify(systemPrompt: string, message: string): Promise<string> {
    const response = await this.client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 50,
      system: systemPrompt,
      messages: [{ role: "user", content: message }],
    });

    return response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
  }
}
