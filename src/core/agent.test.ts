import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Agent } from "./agent.js";
import { EventBus } from "./event-bus.js";
import { StateStore } from "./state.js";
import { PluginHost } from "./plugin-host.js";
import type { NixClawConfig } from "./config.js";
import { unlinkSync, writeFileSync } from "node:fs";

const TEST_DB = "/tmp/nixclaw-agent-test.db";
const FAKE_KEY_FILE = "/tmp/nixclaw-test-apikey";

describe("Agent", () => {
  let bus: EventBus;
  let state: StateStore;
  let host: PluginHost;
  let config: NixClawConfig;

  beforeEach(() => {
    bus = new EventBus();
    state = new StateStore(TEST_DB);
    host = new PluginHost(bus, state);
    writeFileSync(FAKE_KEY_FILE, "test-api-key");
    config = {
      ai: { provider: "claude", model: "claude-sonnet-4-5-20250929", apiKeyFile: FAKE_KEY_FILE },
      channels: { telegram: { enable: false }, webui: { enable: false, port: 3333 } },
      voice: { stt: { provider: "claude" }, tts: { provider: "none" } },
      tools: { nixos: { enable: false }, dev: { enable: false } },
      mcp: { servers: {} },
      stateDir: "/tmp/nixclaw-agent-test-state",
    };
  });

  afterEach(() => {
    state.close();
    try { unlinkSync(TEST_DB); } catch {}
    try { unlinkSync(FAKE_KEY_FILE); } catch {}
  });

  it("creates an agent instance", () => {
    const agent = new Agent(config, bus, state, host);
    expect(agent).toBeDefined();
  });

  it("emits response events when processing messages", async () => {
    const agent = new Agent(config, bus, state, host);
    const responseSpy = vi.fn();
    bus.on("message:response", responseSpy);

    // Mock the Claude client to avoid real API calls
    (agent as any).claude = {
      chat: vi.fn().mockResolvedValue({ text: "Hello from Claude!", toolResults: [] }),
    };

    bus.emit("message:incoming", {
      id: "test-1",
      channel: "terminal",
      sender: "user",
      text: "hello",
      timestamp: new Date(),
    });

    // Allow async processing
    await new Promise((r) => setTimeout(r, 50));

    expect(responseSpy).toHaveBeenCalledOnce();
    expect(responseSpy.mock.calls[0][0]).toMatchObject({
      channel: "terminal",
      text: "Hello from Claude!",
    });
  });
});
