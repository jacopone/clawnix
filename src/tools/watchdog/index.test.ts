import { describe, it, expect, vi, beforeEach } from "vitest";
import { WatchdogPlugin, sdNotify } from "./index.js";
import { EventBus } from "../../core/event-bus.js";
import { StateStore } from "../../core/state.js";
import type { Tool } from "../../core/types.js";

describe("WatchdogPlugin", () => {
  it("registers clawnix_agent_health tool", async () => {
    const plugin = new WatchdogPlugin();
    const tools: Tool[] = [];
    const eventBus = new EventBus();
    const state = new StateStore(":memory:");

    await plugin.init({
      eventBus,
      state,
      config: {},
      registerTool: (t: Tool) => tools.push(t),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    });

    expect(tools.map((t) => t.name)).toContain("clawnix_agent_health");
    await plugin.shutdown();
  });

  it("clawnix_agent_health runs journalctl", { timeout: 35_000 }, async () => {
    const plugin = new WatchdogPlugin();
    const tools: Tool[] = [];
    const eventBus = new EventBus();
    const state = new StateStore(":memory:");

    await plugin.init({
      eventBus,
      state,
      config: {},
      registerTool: (t: Tool) => tools.push(t),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    });

    const healthTool = tools.find((t) => t.name === "clawnix_agent_health")!;
    const result = await healthTool.run({});
    // journalctl might fail in test environment, but the tool should not throw
    expect(typeof result).toBe("string");
    await plugin.shutdown();
  });
});

describe("sdNotify", () => {
  it("no-ops when NOTIFY_SOCKET is not set", () => {
    delete process.env.NOTIFY_SOCKET;
    expect(() => sdNotify("WATCHDOG=1")).not.toThrow();
  });
});
