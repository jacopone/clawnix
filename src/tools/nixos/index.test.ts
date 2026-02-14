import { describe, it, expect, vi } from "vitest";
import { NixOSToolsPlugin } from "./index.js";
import { EventBus } from "../../core/event-bus.js";
import { StateStore } from "../../core/state.js";
import type { PluginContext, Tool } from "../../core/types.js";
import { unlinkSync } from "node:fs";

const TEST_DB = "/tmp/nixclaw-nixos-tools-test.db";

describe("NixOSToolsPlugin", () => {
  it("implements NixClawPlugin interface", () => {
    const plugin = new NixOSToolsPlugin();
    expect(plugin.name).toBe("nixos-tools");
    expect(plugin.version).toBeDefined();
    expect(plugin.init).toBeInstanceOf(Function);
    expect(plugin.shutdown).toBeInstanceOf(Function);
  });

  it("registers tools on init", async () => {
    const plugin = new NixOSToolsPlugin();
    const bus = new EventBus();
    const state = new StateStore(TEST_DB);
    const tools: Tool[] = [];

    const ctx: PluginContext = {
      eventBus: bus,
      registerTool: (t) => tools.push(t),
      state,
      config: { flakePath: "/tmp/fake-flake" },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    };

    await plugin.init(ctx);

    expect(tools.length).toBeGreaterThanOrEqual(4);
    const names = tools.map((t) => t.name);
    expect(names).toContain("nixclaw_system_status");
    expect(names).toContain("nixclaw_flake_check");
    expect(names).toContain("nixclaw_service_status");
    expect(names).toContain("nixclaw_list_services");

    state.close();
    try {
      unlinkSync(TEST_DB);
    } catch {
      // ignore cleanup errors
    }
  });
});
