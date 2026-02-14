import { describe, it, expect, vi } from "vitest";
import { DevToolsPlugin } from "./index.js";
import { EventBus } from "../../core/event-bus.js";
import { StateStore } from "../../core/state.js";
import type { PluginContext, Tool } from "../../core/types.js";
import { unlinkSync } from "node:fs";

const TEST_DB = "/tmp/nixclaw-dev-tools-test.db";

describe("DevToolsPlugin", () => {
  it("implements NixClawPlugin interface", () => {
    const plugin = new DevToolsPlugin();
    expect(plugin.name).toBe("dev-tools");
  });

  it("registers tools on init", async () => {
    const plugin = new DevToolsPlugin();
    const bus = new EventBus();
    const state = new StateStore(TEST_DB);
    const tools: Tool[] = [];

    const ctx: PluginContext = {
      eventBus: bus,
      registerTool: (t) => tools.push(t),
      state,
      config: {},
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    };

    await plugin.init(ctx);

    expect(tools.length).toBeGreaterThanOrEqual(3);
    const names = tools.map((t) => t.name);
    expect(names).toContain("nixclaw_git_status");
    expect(names).toContain("nixclaw_run_tests");
    expect(names).toContain("nixclaw_claude_sessions");

    state.close();
    try { unlinkSync(TEST_DB); } catch {}
  });
});
