import { describe, it, expect, vi, afterEach } from "vitest";
import { existsSync, unlinkSync } from "node:fs";
import { z } from "zod";
import { EventBus } from "./event-bus.js";
import { StateStore } from "./state.js";
import { PluginHost } from "./plugin-host.js";
import type { NixClawPlugin, PluginContext } from "./types.js";

const DB_PATH = "/tmp/nixclaw-pluginhost-test.db";

function cleanup() {
  for (const suffix of ["", "-wal", "-shm"]) {
    const file = DB_PATH + suffix;
    if (existsSync(file)) unlinkSync(file);
  }
}

function createTestPlugin(overrides: Partial<NixClawPlugin> = {}): NixClawPlugin {
  return {
    name: "test-plugin",
    version: "1.0.0",
    init: vi.fn(async () => {}),
    shutdown: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("PluginHost", () => {
  afterEach(() => {
    cleanup();
  });

  it("initializes plugins with correct context", async () => {
    const bus = new EventBus();
    const state = new StateStore(DB_PATH);
    const host = new PluginHost(bus, state);
    const plugin = createTestPlugin();

    await host.register(plugin, { foo: "bar" });
    await host.initAll();

    expect(plugin.init).toHaveBeenCalledOnce();
    const ctx = (plugin.init as ReturnType<typeof vi.fn>).mock.calls[0][0] as PluginContext;
    expect(ctx.eventBus).toBe(bus);
    expect(ctx.state).toBe(state);
    expect(ctx.config).toEqual({ foo: "bar" });
    expect(ctx.logger).toBeDefined();
    expect(typeof ctx.registerTool).toBe("function");
    state.close();
  });

  it("collects tools registered by plugins", async () => {
    const bus = new EventBus();
    const state = new StateStore(DB_PATH);
    const host = new PluginHost(bus, state);

    const plugin = createTestPlugin({
      init: async (ctx: PluginContext) => {
        ctx.registerTool({
          name: "greet",
          description: "Says hello",
          inputSchema: z.object({ name: z.string() }),
          run: async (input) => {
            const { name } = input as { name: string };
            return `Hello, ${name}!`;
          },
        });
      },
    });

    await host.register(plugin, {});
    await host.initAll();

    const tools = host.getTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("greet");
    const result = await tools[0].run({ name: "world" });
    expect(result).toBe("Hello, world!");
    state.close();
  });

  it("calls shutdown on all plugins", async () => {
    const bus = new EventBus();
    const state = new StateStore(DB_PATH);
    const host = new PluginHost(bus, state);

    const p1 = createTestPlugin({ name: "plugin-a" });
    const p2 = createTestPlugin({ name: "plugin-b" });

    await host.register(p1, {});
    await host.register(p2, {});
    await host.initAll();
    await host.shutdownAll();

    expect(p1.shutdown).toHaveBeenCalledOnce();
    expect(p2.shutdown).toHaveBeenCalledOnce();
    state.close();
  });
});
