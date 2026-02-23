import Anthropic from "@anthropic-ai/sdk";
import type { Tool } from "../core/types.js";
import { z } from "zod";

export function formatToolsForAPI(tools: Tool[]): Anthropic.Tool[] {
  return tools.map((t) => {
    const schema = t.rawInputSchema
      ? { type: "object" as const, ...t.rawInputSchema }
      : z.toJSONSchema(t.inputSchema);
    return {
      name: t.name,
      description: t.description,
      input_schema: schema as Anthropic.Tool.InputSchema,
    };
  });
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AgentResponse {
  text: string;
  toolResults: Array<{ tool: string; input: unknown; output: string }>;
  usage: TokenUsage;
}

/** Called before tool execution. Returns "allow" to proceed or "deny" to block. */
export type ApprovalGate = (toolName: string, input: unknown) => Promise<"allow" | "deny">;

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
    approvalGate?: ApprovalGate,
  ): Promise<AgentResponse> {
    const apiTools = formatToolsForAPI(tools);
    const toolResults: AgentResponse["toolResults"] = [];
    const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
    let currentMessages = [...messages];

    while (true) {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: currentMessages,
        tools: apiTools.length > 0 ? apiTools : undefined,
      });

      // Accumulate token usage across all turns in the loop
      usage.inputTokens += response.usage?.input_tokens ?? 0;
      usage.outputTokens += response.usage?.output_tokens ?? 0;

      if (response.stop_reason !== "tool_use") {
        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("");
        return { text, toolResults, usage };
      }

      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );

      const toolResultContents: Anthropic.ToolResultBlockParam[] = [];

      for (const toolUse of toolUseBlocks) {
        const tool = tools.find((t) => t.name === toolUse.name);
        let output: string;
        if (tool) {
          // Check approval gate before execution
          if (approvalGate) {
            const decision = await approvalGate(toolUse.name, toolUse.input);
            if (decision === "deny") {
              output = "Tool execution was denied by policy or user.";
              toolResults.push({ tool: toolUse.name, input: toolUse.input, output });
              toolResultContents.push({
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: output,
              });
              continue;
            }
          }
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
