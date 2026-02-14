import Anthropic from "@anthropic-ai/sdk";
import type { Tool } from "../core/types.js";
import { z } from "zod";

export function formatToolsForAPI(tools: Tool[]): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: z.toJSONSchema(t.inputSchema) as Anthropic.Tool.InputSchema,
  }));
}

export interface AgentResponse {
  text: string;
  toolResults: Array<{ tool: string; input: unknown; output: string }>;
}

export class ClaudeClient {
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async chat(
    messages: Anthropic.MessageParam[],
    tools: Tool[],
    systemPrompt: string,
  ): Promise<AgentResponse> {
    const apiTools = formatToolsForAPI(tools);
    const toolResults: AgentResponse["toolResults"] = [];
    let currentMessages = [...messages];

    while (true) {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: currentMessages,
        tools: apiTools.length > 0 ? apiTools : undefined,
      });

      if (response.stop_reason !== "tool_use") {
        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("");
        return { text, toolResults };
      }

      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );

      const toolResultContents: Anthropic.ToolResultBlockParam[] = [];

      for (const toolUse of toolUseBlocks) {
        const tool = tools.find((t) => t.name === toolUse.name);
        let output: string;
        if (tool) {
          try {
            output = await tool.run(toolUse.input);
          } catch (err) {
            output = `Error: ${err instanceof Error ? err.message : String(err)}`;
          }
        } else {
          output = `Error: Unknown tool "${toolUse.name}"`;
        }
        toolResults.push({ tool: toolUse.name, input: toolUse.input, output });
        toolResultContents.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: output,
        });
      }

      currentMessages = [
        ...currentMessages,
        { role: "assistant", content: response.content },
        { role: "user", content: toolResultContents },
      ];
    }
  }
}
