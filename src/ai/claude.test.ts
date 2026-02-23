import { describe, it, expect } from "vitest";
import { ClaudeClient, formatToolsForAPI } from "./claude.js";
import type { Tool } from "../core/types.js";
import { z } from "zod";

describe("formatToolsForAPI", () => {
  it("converts internal tools to Anthropic API format", () => {
    const tools: Tool[] = [
      {
        name: "get_status",
        description: "Get system status",
        inputSchema: z.object({ verbose: z.boolean().optional() }),
        run: async () => "ok",
      },
    ];
    const formatted = formatToolsForAPI(tools);
    expect(formatted).toHaveLength(1);
    expect(formatted[0].name).toBe("get_status");
    expect(formatted[0].description).toBe("Get system status");
    expect(formatted[0].input_schema).toBeDefined();
    expect(formatted[0].input_schema.type).toBe("object");
  });
});

describe("ClaudeClient", () => {
  it("constructs with API key and model", () => {
    const client = new ClaudeClient("test-key", "claude-sonnet-4-6");
    expect(client).toBeDefined();
  });
});
