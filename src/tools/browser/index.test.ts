import { describe, it, expect, vi } from "vitest";
import { BrowserPlugin } from "./index.js";
import { EventBus } from "../../core/event-bus.js";
import { StateStore } from "../../core/state.js";
import type { PluginContext, Tool } from "../../core/types.js";
import { unlinkSync } from "node:fs";

const TEST_DB = "/tmp/clawnix-browser-test.db";

function makeCtx(
  config: Record<string, unknown> = {},
): { ctx: PluginContext; tools: Tool[]; state: StateStore } {
  const bus = new EventBus();
  const state = new StateStore(TEST_DB);
  const tools: Tool[] = [];
  const ctx: PluginContext = {
    eventBus: bus,
    registerTool: (t) => tools.push(t),
    state,
    config,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  };
  return { ctx, tools, state };
}

describe("BrowserPlugin", () => {
  it("registers all browser tools on init", async () => {
    const plugin = new BrowserPlugin();
    const { ctx, tools, state } = makeCtx({ headless: true });

    await plugin.init(ctx);

    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("clawnix_browser_open");
    expect(toolNames).toContain("clawnix_browser_snapshot");
    expect(toolNames).toContain("clawnix_browser_click");
    expect(toolNames).toContain("clawnix_browser_type");
    expect(toolNames).toContain("clawnix_browser_fill");
    expect(toolNames).toContain("clawnix_browser_screenshot");
    expect(toolNames).toContain("clawnix_browser_evaluate");
    expect(tools).toHaveLength(7);

    state.close();
    try {
      unlinkSync(TEST_DB);
    } catch {}
  });

  it("errors when using tools without opening page first", async () => {
    const plugin = new BrowserPlugin();
    const { ctx, tools, state } = makeCtx({ headless: true });

    await plugin.init(ctx);
    const clickTool = tools.find((t) => t.name === "clawnix_browser_click")!;

    const result = await clickTool.run({ ref: "e1" });
    expect(result).toContain("No page open");

    state.close();
    try {
      unlinkSync(TEST_DB);
    } catch {}
  });

  it("snapshot tool errors without page", async () => {
    const plugin = new BrowserPlugin();
    const { ctx, tools, state } = makeCtx({ headless: true });

    await plugin.init(ctx);
    const snapshotTool = tools.find(
      (t) => t.name === "clawnix_browser_snapshot",
    )!;

    const result = await snapshotTool.run({});
    expect(result).toContain("No page open");

    state.close();
    try {
      unlinkSync(TEST_DB);
    } catch {}
  });

  it("shutdown is safe when no browser launched", async () => {
    const plugin = new BrowserPlugin();
    const { ctx, state } = makeCtx({ headless: true });

    await plugin.init(ctx);
    await plugin.shutdown(); // should not throw

    state.close();
    try {
      unlinkSync(TEST_DB);
    } catch {}
  });
});
