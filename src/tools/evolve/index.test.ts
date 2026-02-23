import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EvolvePlugin } from "./index.js";
import { EventBus } from "../../core/event-bus.js";
import { StateStore } from "../../core/state.js";
import type { PluginContext, Tool } from "../../core/types.js";
import { unlinkSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const TEST_DB = "/tmp/clawnix-evolve-test.db";
const TEST_CONFIG_DIR = "/tmp/clawnix-evolve-test";
const TEST_CONFIG_FILE = join(TEST_CONFIG_DIR, "clawnix-evolved.nix");

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

function cleanup() {
  try { unlinkSync(TEST_DB); } catch {}
  try { unlinkSync(TEST_CONFIG_FILE); } catch {}
}

describe("EvolvePlugin", () => {
  beforeEach(() => {
    mkdirSync(TEST_CONFIG_DIR, { recursive: true });
    cleanup();
  });

  afterEach(() => {
    cleanup();
  });

  it("registers clawnix_evolve tool on init", async () => {
    const plugin = new EvolvePlugin();
    const { ctx, tools, state } = makeCtx({ configFile: TEST_CONFIG_FILE });

    await plugin.init(ctx);

    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("clawnix_evolve");

    state.close();
  });

  it("status shows default content when no overlay exists", async () => {
    const plugin = new EvolvePlugin();
    const { ctx, tools, state } = makeCtx({ configFile: TEST_CONFIG_FILE });

    await plugin.init(ctx);
    const tool = tools[0];

    const result = await tool.run({ action: "status" });
    const parsed = JSON.parse(result);

    expect(parsed.action).toBe("status");
    expect(parsed.exists).toBe(false);
    expect(parsed.content).toContain("ClawNix evolved configuration");

    state.close();
  });

  it("status shows existing overlay content", async () => {
    const existingContent = "{ config, pkgs, ... }:\n{ services.nginx.enable = true; }\n";
    writeFileSync(TEST_CONFIG_FILE, existingContent);

    const plugin = new EvolvePlugin();
    const { ctx, tools, state } = makeCtx({ configFile: TEST_CONFIG_FILE });

    await plugin.init(ctx);
    const tool = tools[0];

    const result = await tool.run({ action: "status" });
    const parsed = JSON.parse(result);

    expect(parsed.exists).toBe(true);
    expect(parsed.content).toContain("nginx");

    state.close();
  });

  it("propose requires nixContent", async () => {
    const plugin = new EvolvePlugin();
    const { ctx, tools, state } = makeCtx({ configFile: TEST_CONFIG_FILE });

    await plugin.init(ctx);
    const tool = tools[0];

    const result = await tool.run({ action: "propose", description: "test" });
    expect(result).toContain("nixContent");
    expect(result).toContain("required");

    state.close();
  });

  it("propose requires description", async () => {
    const plugin = new EvolvePlugin();
    const { ctx, tools, state } = makeCtx({ configFile: TEST_CONFIG_FILE });

    await plugin.init(ctx);
    const tool = tools[0];

    const result = await tool.run({
      action: "propose",
      nixContent: "{ config, pkgs, ... }: {}",
    });
    expect(result).toContain("description");
    expect(result).toContain("required");

    state.close();
  });

  it("propose writes config file and generates diff", async () => {
    const plugin = new EvolvePlugin();
    const { ctx, tools, state } = makeCtx({
      configFile: TEST_CONFIG_FILE,
      // Use a non-existent flake path so validation fails fast
      // (we're testing the write + diff logic, not actual nix rebuild)
      flakePath: "/nonexistent",
    });

    await plugin.init(ctx);
    const tool = tools[0];

    const newContent = "{ config, pkgs, ... }:\n{\n  services.nginx.enable = true;\n}\n";
    const result = await tool.run({
      action: "propose",
      description: "Enable nginx",
      nixContent: newContent,
    });
    const parsed = JSON.parse(result);

    // Will fail validation since /nonexistent isn't a real flake
    expect(parsed.action).toBe("propose");
    expect(parsed.status).toBe("validation_failed");
    expect(parsed.diff).toContain("+");
    expect(parsed.description).toBe("Enable nginx");

    // Config should be reverted after validation failure
    expect(existsSync(TEST_CONFIG_FILE)).toBe(true);
    const restored = readFileSync(TEST_CONFIG_FILE, "utf-8");
    expect(restored).not.toContain("nginx");

    state.close();
  });
});
