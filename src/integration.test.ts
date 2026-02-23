import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventBus } from "./core/event-bus.js";
import { StateStore } from "./core/state.js";
import { PluginHost } from "./core/plugin-host.js";
import { Agent } from "./core/agent.js";
import type { ClawNixConfig } from "./core/config.js";
import type { ClawNixMessage } from "./core/types.js";
import { writeFileSync, unlinkSync } from "node:fs";
import { z } from "zod";

const TEST_DB = "/tmp/clawnix-integration-test.db";
const FAKE_KEY_FILE = "/tmp/clawnix-integration-apikey";

describe("ClawNix Integration", () => {
  let bus: EventBus;
  let state: StateStore;
  let host: PluginHost;
  let config: ClawNixConfig;

  beforeEach(() => {
    bus = new EventBus();
    state = new StateStore(TEST_DB);
    host = new PluginHost(bus, state);
    writeFileSync(FAKE_KEY_FILE, "test-api-key");
    config = {
      ai: { provider: "claude", model: "claude-sonnet-4-6", apiKeyFile: FAKE_KEY_FILE },
      channels: { telegram: { enable: false }, webui: { enable: false, port: 3333 } },
      voice: { stt: { provider: "claude" }, tts: { provider: "none" } },
      tools: { nixos: { enable: false }, dev: { enable: false } },
      mcp: { servers: {} },
      workspaceDir: "/tmp/clawnix-integration-workspace",
      stateDir: "/tmp/clawnix-integration-state",
    };
  });

  afterEach(() => {
    state.close();
    try { unlinkSync(TEST_DB); } catch {}
    try { unlinkSync(FAKE_KEY_FILE); } catch {}
  });

  it("processes a message through the full agent pipeline", async () => {
    // Register a test tool
    host.registerExternalTool({
      name: "test_echo",
      description: "Echo back the input",
      inputSchema: z.object({ text: z.string() }),
      run: async (input) => {
        const { text } = input as { text: string };
        return `Echo: ${text}`;
      },
    });

    // Create the agent (internally creates ClaudeClient)
    const agent = new Agent(config, bus, state, host);

    // Mock the internal Claude client
    (agent as any).claude = {
      chat: vi.fn().mockResolvedValue({
        text: "Integration test response",
        toolResults: [],
        usage: { inputTokens: 200, outputTokens: 100 },
      }),
    };

    // Set up response listener
    const responses: unknown[] = [];
    bus.on("message:response", (payload) => responses.push(payload));

    // Emit a message
    const testMsg: ClawNixMessage = {
      id: "integration-test-1",
      channel: "terminal",
      sender: "test-user",
      text: "Hello ClawNix",
      timestamp: new Date(),
    };
    bus.emit("message:incoming", testMsg);

    // Wait for async processing
    await new Promise((r) => setTimeout(r, 100));

    // Verify response was emitted
    expect(responses).toHaveLength(1);
    const response = responses[0] as any;
    expect(response.channel).toBe("terminal");
    expect(response.sender).toBe("test-user");
    expect(response.text).toBe("Integration test response");
  });

  it("makes tools available to the agent", async () => {
    const toolSpy = vi.fn().mockResolvedValue("tool output");

    host.registerExternalTool({
      name: "test_spy_tool",
      description: "A test tool",
      inputSchema: z.object({}),
      run: toolSpy,
    });

    const agent = new Agent(config, bus, state, host);

    // Mock Claude to simulate a tool call followed by final response
    (agent as any).claude = {
      chat: vi.fn().mockResolvedValue({
        text: "Used the tool successfully",
        toolResults: [{ tool: "test_spy_tool", input: {}, output: "tool output" }],
        usage: { inputTokens: 300, outputTokens: 150 },
      }),
    };

    const responses: unknown[] = [];
    bus.on("message:response", (payload) => responses.push(payload));

    bus.emit("message:incoming", {
      id: "tool-test-1",
      channel: "terminal",
      sender: "test-user",
      text: "use the tool",
      timestamp: new Date(),
    });

    await new Promise((r) => setTimeout(r, 100));

    expect(responses).toHaveLength(1);
    const response = responses[0] as any;
    expect(response.text).toBe("Used the tool successfully");
    expect(response.toolResults).toHaveLength(1);
  });
});
