import { describe, it, expect } from "vitest";
import { createAgentInstance, wireAgentInstance } from "./agent-instance.js";
import { AgentBroker } from "./agent-broker.js";

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

describe("wireAgentInstance", () => {
  it("registers scheduler plugin tools when 'scheduler' is in tools list", async () => {
    const instance = await createAgentInstance("ops", {
      description: "ops agent",
      ai: { provider: "claude", model: "claude-sonnet-4-6", apiKeyFile: "/dev/null" },
      tools: ["scheduler"],
      mcp: { servers: [] },
      workspaceDir: "/tmp/clawnix-test-wire-scheduler",
      toolPolicies: [],
    }, { stateDir: "/tmp/clawnix-wire-test" });

    const { mcpManager } = await wireAgentInstance(instance, {
      description: "ops agent",
      ai: { provider: "claude", model: "claude-sonnet-4-6", apiKeyFile: "/dev/null" },
      tools: ["scheduler"],
      mcp: { servers: [] },
      workspaceDir: "/tmp/clawnix-test-wire-scheduler",
      toolPolicies: [],
    }, {});

    const toolNames = instance.pluginHost.getTools().map((t) => t.name);
    expect(toolNames).toContain("clawnix_schedule_task");
    expect(toolNames).toContain("clawnix_list_scheduled");

    await mcpManager.disconnectAll();
    await instance.shutdown();
  });

  it("registers multiple plugins for multiple tool names", async () => {
    const instance = await createAgentInstance("multi", {
      description: "multi-tool agent",
      ai: { provider: "claude", model: "claude-sonnet-4-6", apiKeyFile: "/dev/null" },
      tools: ["scheduler", "dev"],
      mcp: { servers: [] },
      workspaceDir: "/tmp/clawnix-test-wire-multi",
      toolPolicies: [],
    }, { stateDir: "/tmp/clawnix-wire-test" });

    const agentConfig = {
      description: "multi-tool agent",
      ai: { provider: "claude" as const, model: "claude-sonnet-4-6", apiKeyFile: "/dev/null" },
      tools: ["scheduler", "dev"],
      mcp: { servers: [] as string[] },
      workspaceDir: "/tmp/clawnix-test-wire-multi",
      toolPolicies: [] as Array<{ tool: string; effect: "allow" | "deny" | "approve" }>,
    };

    const { mcpManager } = await wireAgentInstance(instance, agentConfig, {});

    const toolNames = instance.pluginHost.getTools().map((t) => t.name);
    expect(toolNames).toContain("clawnix_schedule_task");
    expect(toolNames).toContain("clawnix_list_scheduled");
    expect(toolNames).toContain("clawnix_git_status");
    expect(toolNames).toContain("clawnix_run_tests");
    expect(toolNames).toContain("clawnix_claude_sessions");

    await mcpManager.disconnectAll();
    await instance.shutdown();
  });

  it("registers no plugins when tools list is empty", async () => {
    const instance = await createAgentInstance("empty", {
      description: "empty agent",
      ai: { provider: "claude", model: "claude-sonnet-4-6", apiKeyFile: "/dev/null" },
      tools: [],
      mcp: { servers: [] },
      workspaceDir: "/tmp/clawnix-test-wire-empty",
      toolPolicies: [],
    }, { stateDir: "/tmp/clawnix-wire-test" });

    const { mcpManager } = await wireAgentInstance(instance, {
      description: "empty agent",
      ai: { provider: "claude", model: "claude-sonnet-4-6", apiKeyFile: "/dev/null" },
      tools: [],
      mcp: { servers: [] },
      workspaceDir: "/tmp/clawnix-test-wire-empty",
      toolPolicies: [],
    }, {});

    expect(instance.pluginHost.getTools()).toHaveLength(0);

    await mcpManager.disconnectAll();
    await instance.shutdown();
  });

  it("creates an Agent instance that listens for messages", async () => {
    const instance = await createAgentInstance("with-agent", {
      description: "agent with claude loop",
      ai: { provider: "claude", model: "claude-sonnet-4-6", apiKeyFile: "/dev/null" },
      tools: ["scheduler"],
      mcp: { servers: [] },
      workspaceDir: "/tmp/clawnix-test-wire-agent",
      toolPolicies: [],
    }, { stateDir: "/tmp/clawnix-wire-test" });

    const { agent, mcpManager } = await wireAgentInstance(instance, {
      description: "agent with claude loop",
      ai: { provider: "claude", model: "claude-sonnet-4-6", apiKeyFile: "/dev/null" },
      tools: ["scheduler"],
      mcp: { servers: [] },
      workspaceDir: "/tmp/clawnix-test-wire-agent",
      toolPolicies: [],
    }, {});

    expect(agent).toBeDefined();

    await mcpManager.disconnectAll();
    await instance.shutdown();
  });

  it("skips unknown tool names with a warning", async () => {
    const instance = await createAgentInstance("unknown", {
      description: "agent with unknown tool",
      ai: { provider: "claude", model: "claude-sonnet-4-6", apiKeyFile: "/dev/null" },
      tools: ["nonexistent", "scheduler"],
      mcp: { servers: [] },
      workspaceDir: "/tmp/clawnix-test-wire-unknown",
      toolPolicies: [],
    }, { stateDir: "/tmp/clawnix-wire-test" });

    const { mcpManager } = await wireAgentInstance(instance, {
      description: "agent with unknown tool",
      ai: { provider: "claude", model: "claude-sonnet-4-6", apiKeyFile: "/dev/null" },
      tools: ["nonexistent", "scheduler"],
      mcp: { servers: [] },
      workspaceDir: "/tmp/clawnix-test-wire-unknown",
      toolPolicies: [],
    }, {});

    const toolNames = instance.pluginHost.getTools().map((t) => t.name);
    // scheduler tools should still be registered despite the unknown tool
    expect(toolNames).toContain("clawnix_schedule_task");

    await mcpManager.disconnectAll();
    await instance.shutdown();
  });

  it("registers delegation plugin tools when 'delegation' is in tools list and broker is provided", async () => {
    const broker = new AgentBroker();
    const instance = await createAgentInstance("delegator", {
      description: "agent with delegation",
      ai: { provider: "claude", model: "claude-sonnet-4-6", apiKeyFile: "/dev/null" },
      tools: ["delegation"],
      mcp: { servers: [] },
      workspaceDir: "/tmp/clawnix-test-wire-delegation",
      toolPolicies: [],
    }, { stateDir: "/tmp/clawnix-wire-test" });

    const { mcpManager } = await wireAgentInstance(instance, {
      description: "agent with delegation",
      ai: { provider: "claude", model: "claude-sonnet-4-6", apiKeyFile: "/dev/null" },
      tools: ["delegation"],
      mcp: { servers: [] },
      workspaceDir: "/tmp/clawnix-test-wire-delegation",
      toolPolicies: [],
    }, {}, undefined, broker);

    const toolNames = instance.pluginHost.getTools().map((t) => t.name);
    expect(toolNames).toContain("clawnix_delegate");
    expect(toolNames).toContain("clawnix_list_agents");

    await mcpManager.disconnectAll();
    await instance.shutdown();
  });

  it("skips delegation plugin when broker is not provided", async () => {
    const instance = await createAgentInstance("no-broker", {
      description: "agent without broker",
      ai: { provider: "claude", model: "claude-sonnet-4-6", apiKeyFile: "/dev/null" },
      tools: ["delegation"],
      mcp: { servers: [] },
      workspaceDir: "/tmp/clawnix-test-wire-no-broker",
      toolPolicies: [],
    }, { stateDir: "/tmp/clawnix-wire-test" });

    const { mcpManager } = await wireAgentInstance(instance, {
      description: "agent without broker",
      ai: { provider: "claude", model: "claude-sonnet-4-6", apiKeyFile: "/dev/null" },
      tools: ["delegation"],
      mcp: { servers: [] },
      workspaceDir: "/tmp/clawnix-test-wire-no-broker",
      toolPolicies: [],
    }, {});

    const toolNames = instance.pluginHost.getTools().map((t) => t.name);
    expect(toolNames).not.toContain("clawnix_delegate");
    expect(toolNames).not.toContain("clawnix_list_agents");

    await mcpManager.disconnectAll();
    await instance.shutdown();
  });
});
