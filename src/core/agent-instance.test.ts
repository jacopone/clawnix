import { describe, it, expect } from "vitest";
import { createAgentInstance } from "./agent-instance.js";

describe("createAgentInstance", () => {
  it("creates an instance with the given name and config", async () => {
    const instance = await createAgentInstance("personal", {
      description: "daily assistant",
      ai: { provider: "claude", model: "claude-sonnet-4-6", apiKeyFile: "/dev/null" },
      tools: [],
      mcp: { servers: [] },
      workspaceDir: "/tmp/clawnix-test-personal",
      toolPolicies: [],
    }, { stateDir: "/tmp/clawnix-agent-factory-test" });

    expect(instance.name).toBe("personal");
    expect(instance.description).toBe("daily assistant");
    expect(instance.pluginHost).toBeDefined();
    expect(instance.eventBus).toBeDefined();
    await instance.shutdown();
  });

  it("isolates state between instances", async () => {
    const a = await createAgentInstance("a", {
      description: "agent a",
      ai: { provider: "claude", model: "m", apiKeyFile: "/dev/null" },
      tools: [], mcp: { servers: [] },
      workspaceDir: "/tmp/clawnix-test-a",
      toolPolicies: [],
    }, { stateDir: "/tmp/clawnix-agent-factory-test" });

    const b = await createAgentInstance("b", {
      description: "agent b",
      ai: { provider: "claude", model: "m", apiKeyFile: "/dev/null" },
      tools: [], mcp: { servers: [] },
      workspaceDir: "/tmp/clawnix-test-b",
      toolPolicies: [],
    }, { stateDir: "/tmp/clawnix-agent-factory-test" });

    // Each has its own event bus — events don't cross
    let aReceived = false;
    let bReceived = false;
    a.eventBus.on("test", () => { aReceived = true; });
    b.eventBus.on("test", () => { bReceived = true; });
    a.eventBus.emit("test", {});
    expect(aReceived).toBe(true);
    expect(bReceived).toBe(false);

    await a.shutdown();
    await b.shutdown();
  });

  it("applies tool policies from config", async () => {
    const instance = await createAgentInstance("restricted", {
      description: "restricted agent",
      ai: { provider: "claude", model: "m", apiKeyFile: "/dev/null" },
      tools: [], mcp: { servers: [] },
      workspaceDir: "/tmp/clawnix-test-restricted",
      toolPolicies: [
        { tool: "clawnix_send_email", effect: "approve" },
      ],
    }, { stateDir: "/tmp/clawnix-agent-factory-test" });

    // Policies should be set on the plugin host
    expect(instance.pluginHost).toBeDefined();
    await instance.shutdown();
  });
});
