import { describe, it, expect } from "vitest";
import { McpClientManager } from "./mcp-client.js";

describe("McpClientManager", () => {
  it("constructs with empty server config", () => {
    const mgr = new McpClientManager({});
    expect(mgr).toBeDefined();
  });

  it("returns empty tools when no servers configured", async () => {
    const mgr = new McpClientManager({});
    const tools = await mgr.getAllTools();
    expect(tools).toEqual([]);
  });
});
